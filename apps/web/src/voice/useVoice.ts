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
export function useVoice(onText: (text: string) => void, onError: (text: string) => void) {
  const ref = useRef<Recognition | null>(null),
    callback = useRef(onText),
    error = useRef(onError);
  callback.current = onText;
  error.current = onError;
  const [listening, setListening] = useState(false),
    [interim, setInterim] = useState('');
  const supported = Boolean(
    (window as SpeechWindow).SpeechRecognition ?? (window as SpeechWindow).webkitSpeechRecognition,
  );
  function stop() {
    const current = ref.current;
    ref.current = null;
    if (current) {
      current.onresult = null;
      current.onerror = null;
      current.onend = null;
      current.abort();
    }
    setListening(false);
    setInterim('');
  }
  function start() {
    stop();
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    const Constructor =
      (window as SpeechWindow).SpeechRecognition ??
      (window as SpeechWindow).webkitSpeechRecognition;
    if (!Constructor) return error.current('Speech is unavailable here. You can type any command.');
    const r = new Constructor();
    ref.current = r;
    r.lang = 'en-IN';
    r.interimResults = true;
    r.continuous = true;
    const seen = new Set<number>();
    let finalText = '';
    r.onresult = (e) => {
      if (ref.current !== r) return;
      let partial = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const v = e.results[i]!;
        if (v.isFinal && !seen.has(i)) {
          seen.add(i);
          finalText += `${v[0].transcript} `;
          callback.current(finalText.trim());
        } else if (!v.isFinal) partial += v[0].transcript;
      }
      setInterim(partial);
    };
    r.onerror = (e) => {
      error.current(`Microphone: ${e.error}. Typing remains available.`);
      stop();
    };
    r.onend = () => {
      if (ref.current === r) {
        ref.current = null;
        setListening(false);
        setInterim('');
      }
    };
    try {
      r.start();
      setListening(true);
    } catch {
      stop();
      error.current('Could not start listening. Try again or type.');
    }
  }
  useEffect(() => () => ref.current?.abort(), []);
  function warn(names: string[]) {
    stop();
    if (!names.length) return;
    const message = `Low stock: ${names.join(', ')}`;
    try {
      if ('speechSynthesis' in window) {
        speechSynthesis.cancel();
        speechSynthesis.speak(new SpeechSynthesisUtterance(message));
      }
      const Audio = window.AudioContext;
      if (Audio) {
        const audio = new Audio();
        const oscillator = audio.createOscillator(),
          gain = audio.createGain();
        gain.gain.value = 0.08;
        oscillator.frequency.value = 660;
        oscillator.connect(gain);
        gain.connect(audio.destination);
        oscillator.start();
        oscillator.stop(audio.currentTime + 0.2);
        oscillator.onended = () => {
          void audio.close();
        };
      }
    } catch {
      error.current(message);
    }
  }
  return { supported, listening, interim, start, stop, warn };
}
