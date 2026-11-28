import { useEffect, useRef, useState } from 'react';
import { commandAudioLimit } from '@munim/contracts';

type Phase = 'idle' | 'requesting' | 'recording' | 'ready' | 'transcribing';
type Capture = {
  controller: AbortController;
  recorder?: MediaRecorder;
  timer?: number;
  clip?: Blob;
  sendOnStop: boolean;
};
const formats = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'];

export function useRecordedCommand(
  transcribe: (clip: Blob, signal: AbortSignal) => Promise<{ transcript: string }>,
  onTranscript: (text: string) => void,
  notify: (text: string) => void,
) {
  const current = useRef<Capture | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const supported =
    typeof MediaRecorder !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function';

  function release(capture: Capture) {
    window.clearTimeout(capture.timer);
    const recorder = capture.recorder;
    if (!recorder) return;
    capture.recorder = undefined;
    recorder.ondataavailable = null;
    recorder.onstop = null;
    recorder.onerror = null;
    if (recorder.state !== 'inactive') recorder.stop();
    for (const track of recorder.stream.getTracks()) track.stop();
  }

  function clear() {
    const capture = current.current;
    current.current = null;
    if (!capture) return;
    capture.controller.abort();
    release(capture);
  }

  function discard() {
    clear();
    setPhase('idle');
  }

  function failed(message: string) {
    discard();
    notify(message);
  }

  async function send(capture: Capture, clip: Blob) {
    setPhase('transcribing');
    try {
      const { transcript } = await transcribe(clip, capture.controller.signal);
      if (current.current !== capture) return;
      discard();
      onTranscript(transcript);
      notify('Recording transcribed. Review the text and use the command.');
    } catch (error) {
      if (current.current === capture)
        failed(error instanceof Error ? error.message : 'Could not transcribe the recording.');
    }
  }

  async function start() {
    if (!supported || current.current || document.hidden) return;
    const capture: Capture = { controller: new AbortController(), sendOnStop: false };
    current.current = capture;
    setPhase('requesting');
    let stream: MediaStream | undefined;
    try {
      const mimeType = formats.find((format) => MediaRecorder.isTypeSupported(format));
      if (!mimeType) return failed('Audio recording is unavailable in this browser.');
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (current.current !== capture) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      const recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 64_000 });
      capture.recorder = recorder;
      const chunks: Blob[] = [];
      recorder.ondataavailable = ({ data }) => {
        if (data.size) chunks.push(data);
      };
      recorder.onstop = () => {
        if (current.current !== capture) return;
        release(capture);
        const clip = new Blob(chunks, { type: recorder.mimeType || mimeType });
        if (!clip.size || clip.size > commandAudioLimit)
          return failed('Record one short command and try again.');
        if (capture.sendOnStop) void send(capture, clip);
        else {
          capture.clip = clip;
          setPhase('ready');
        }
      };
      recorder.onerror = () => failed('Recording failed. Try again or use keyboard dictation.');
      recorder.start();
      capture.timer = window.setTimeout(() => {
        if (recorder.state === 'recording') recorder.stop();
      }, 12000);
      setPhase('recording');
    } catch (error) {
      for (const track of stream?.getTracks() ?? []) track.stop();
      if (current.current !== capture) return;
      failed(
        error instanceof DOMException && error.name === 'NotAllowedError'
          ? 'Microphone access is blocked. Allow it in the browser or use keyboard dictation.'
          : 'Could not access your microphone. Try again or use keyboard dictation.',
      );
    }
  }

  function transcribeRecording() {
    const capture = current.current;
    if (!capture) return;
    if (capture.clip) {
      const clip = capture.clip;
      capture.clip = undefined;
      void send(capture, clip);
    } else if (capture.recorder?.state === 'recording') {
      capture.sendOnStop = true;
      capture.recorder.stop();
    }
  }

  useEffect(() => {
    function onHidden() {
      if (document.hidden) discard();
    }
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('pagehide', discard);
    return () => {
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('pagehide', discard);
      clear();
    };
  }, []);

  return { supported, phase, start, transcribeRecording, discard };
}
