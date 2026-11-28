import { useEffect, useRef, useState } from 'react';

interface RecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface RecognitionEvent {
  resultIndex: number;
  results: { length: number; [index: number]: RecognitionResult };
}
interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  abort(): void;
}
type SpeechWindow = Window & {
  SpeechRecognition?: new () => Recognition;
  webkitSpeechRecognition?: new () => Recognition;
};
type Session = {
  controller: AbortController;
  recognizing?: Recognition;
  restart?: number;
  processing: boolean;
};
const wakePhrase = /^\s*munim\b[\s,.:!?-]*/i;
const recognitionConstructor = () =>
  (window as SpeechWindow).SpeechRecognition ?? (window as SpeechWindow).webkitSpeechRecognition;

export function useVoice(
  onCommand: (command: string, signal: AbortSignal) => Promise<void>,
  notify: (message: string) => void,
) {
  const current = useRef<Session | undefined>(undefined);
  const speech = useRef<((completed: boolean) => void) | undefined>(undefined);
  const commandCallback = useRef(onCommand);
  const notifyCallback = useRef(notify);
  commandCallback.current = onCommand;
  notifyCallback.current = notify;
  const [active, setActive] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');

  function release(session: Session) {
    window.clearTimeout(session.restart);
    session.restart = undefined;
    const recognizing = session.recognizing;
    if (!recognizing) return;
    session.recognizing = undefined;
    recognizing.onresult = null;
    recognizing.onerror = null;
    recognizing.onend = null;
    recognizing.abort();
  }

  function close() {
    const session = current.current;
    current.current = undefined;
    if (session) {
      session.controller.abort();
      release(session);
    }
    if (speech.current) {
      speech.current(false);
      window.speechSynthesis.cancel();
    }
  }

  function stop() {
    close();
    setActive(false);
    setListening(false);
    setInterim('');
  }

  function microphoneError(message: string) {
    stop();
    notifyCallback.current(message);
  }

  function resume(session: Session) {
    if (
      current.current !== session ||
      session.processing ||
      session.recognizing ||
      session.restart !== undefined ||
      speech.current
    )
      return;
    // Let the previous recognizer and speaker finish releasing their audio streams.
    session.restart = window.setTimeout(() => {
      session.restart = undefined;
      listen(session);
    }, 250);
  }

  function listen(session: Session) {
    if (current.current !== session || session.processing || speech.current) return;
    const Constructor = recognitionConstructor();
    if (!Constructor) return microphoneError('Speech is unavailable. You can type a command.');
    const recognizing = new Constructor();
    session.recognizing = recognizing;
    recognizing.lang = 'en-IN';
    recognizing.interimResults = true;
    recognizing.continuous = true;
    const seen = new Set<number>();
    recognizing.onresult = (event) => {
      if (session.recognizing !== recognizing) return;
      let partial = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]!;
        const transcript = result[0].transcript;
        if (!result.isFinal) {
          partial += transcript;
          continue;
        }
        if (seen.has(i)) continue;
        seen.add(i);
        if (!wakePhrase.test(transcript)) {
          if (transcript.trim()) {
            setInterim(`Heard: "${transcript.trim()}" · Say "Munim, …" to run`);
          }
          continue;
        }
        const command = transcript.replace(wakePhrase, '').trim();
        if (!command) continue;
        session.processing = true;
        release(session);
        setListening(false);
        setInterim('');
        void commandCallback
          .current(command, session.controller.signal)
          .catch(() => {
            if (current.current === session)
              notifyCallback.current('Please try that command again.');
          })
          .finally(() => {
            session.processing = false;
            resume(session);
          });
        return;
      }
      setInterim(partial);
    };
    recognizing.onerror = ({ error }) => {
      if (error === 'no-speech') return; // The browser follows this with its end event.
      if (error === 'network' || error === 'service-not-allowed')
        return microphoneError(
          'Browser speech is unavailable. Tap the mic again to record, or use Wispr Flow / type.',
        );
      microphoneError(`Microphone: ${error}. You can type a command or restart voice.`);
    };
    recognizing.onend = () => {
      if (session.recognizing !== recognizing) return;
      session.recognizing = undefined;
      setListening(false);
      setInterim('');
      resume(session);
    };
    try {
      recognizing.start();
      setListening(true);
    } catch {
      microphoneError('Could not start listening. Try again or type a command.');
    }
  }

  function start() {
    if (current.current || document.hidden) return;
    const session = { controller: new AbortController(), processing: false };
    current.current = session;
    setActive(true);
    listen(session);
  }

  function speak(message: string, signal?: AbortSignal): Promise<boolean> {
    if (signal?.aborted || document.hidden || !('speechSynthesis' in window))
      return Promise.resolve(false);
    const session = current.current;
    if (session) {
      release(session);
      setListening(false);
      setInterim('');
    }
    return new Promise((resolve) => {
      const synth = window.speechSynthesis;
      if (speech.current) {
        speech.current(false);
        synth.cancel();
      }
      const utterance = new SpeechSynthesisUtterance(message);
      utterance.lang = 'en-IN';
      const finish = (completed: boolean) => {
        window.clearTimeout(timer);
        utterance.onend = null;
        utterance.onerror = null;
        speech.current = undefined;
        resolve(completed);
        if (session) resume(session);
      };
      const timer = window.setTimeout(() => {
        finish(false);
        synth.cancel();
      }, 12000);
      speech.current = finish;
      utterance.onend = () => finish(true);
      utterance.onerror = () => finish(false);
      try {
        synth.speak(utterance);
      } catch {
        finish(false);
      }
    });
  }

  useEffect(() => {
    function onHidden() {
      if (document.hidden) stop();
    }
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('pagehide', stop);
    return () => {
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('pagehide', stop);
      close();
    };
  }, []);

  async function warn(names: string[], signal?: AbortSignal) {
    if (!names.length || signal?.aborted) return;
    const spoken = speak(`Low stock: ${names.join(', ')}`, signal);
    try {
      const Audio = window.AudioContext;
      if (Audio) {
        const audio = new Audio();
        const oscillator = audio.createOscillator();
        const gain = audio.createGain();
        gain.gain.value = 0.08;
        oscillator.frequency.value = 660;
        oscillator.connect(gain);
        gain.connect(audio.destination);
        oscillator.start();
        oscillator.stop(audio.currentTime + 0.2);
        oscillator.onended = () => void audio.close();
      }
    } catch {
      // The warning is also spoken and shown in the counter.
    }
    await spoken;
  }

  return {
    supported: Boolean(recognitionConstructor()),
    active,
    listening,
    interim,
    start,
    stop,
    speak,
    warn,
  };
}
