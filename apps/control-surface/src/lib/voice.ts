import { AudioAnalyzer, SmoothedDrive } from './audio';
import { NO_AUDIO_DRIVE, type NeuralAudioDrive } from './neural';

/**
 * Phase C voice foundation — real audio pipeline feeding the Neural Core.
 * Extended with natural human voice synthesis and multi-language STT/TTS support.
 */

export type VoiceStatus = 'unavailable' | 'idle' | 'listening' | 'speaking';

export interface VoiceControllerOptions {
  /** Called every frame with the smoothed spectral drive while listening/speaking. */
  onDrive: (drive: NeuralAudioDrive) => void;
  /** Final speech transcript (STT result). */
  onTranscript: (text: string) => void;
  onStatusChange: (status: VoiceStatus) => void;
  onError: (message: string) => void;
}

export interface LanguageOption {
  code: string;
  label: string;
}

export const SUPPORTED_LANGUAGES: LanguageOption[] = [
  { code: 'en-US', label: 'English (US)' },
  { code: 'en-GB', label: 'English (UK)' },
  { code: 'es-ES', label: 'Spanish (Español)' },
  { code: 'fr-FR', label: 'French (Français)' },
  { code: 'de-DE', label: 'German (Deutsch)' },
  { code: 'it-IT', label: 'Italian (Italiano)' },
  { code: 'hi-IN', label: 'Hindi (हिन्दी)' },
  { code: 'ja-JP', label: 'Japanese (日本語)' },
  { code: 'zh-CN', label: 'Chinese (中文)' },
  { code: 'ko-KR', label: 'Korean (한국어)' },
  { code: 'pt-BR', label: 'Portuguese (Brasil)' },
  { code: 'ru-RU', label: 'Russian (Русский)' },
];

export function findBestVoice(langCode = 'en-US', preferredVoiceName?: string): SpeechSynthesisVoice | null {
  if (!TTS_SUPPORTED) return null;
  const voices = window.speechSynthesis.getVoices();
  if (voices.length === 0) return null;

  if (preferredVoiceName) {
    const match = voices.find(v => v.name === preferredVoiceName);
    if (match) return match;
  }

  const prefix = langCode.slice(0, 2).toLowerCase();
  const langVoices = voices.filter(v => v.lang.toLowerCase().startsWith(prefix));
  if (langVoices.length === 0) return voices[0] ?? null;

  // Prioritize high-fidelity natural neural voice engines
  const naturalKeywords = ['natural', 'online', 'neural', 'google', 'microsoft', 'premium', 'enhanced', 'samantha', 'karen', 'daniel', 'serena'];
  for (const kw of naturalKeywords) {
    const match = langVoices.find(v => v.name.toLowerCase().includes(kw));
    if (match) return match;
  }

  return langVoices.find(v => v.localService) ?? langVoices[0];
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

function speechRecognitionCtor(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: SpeechRecognitionConstructor; webkitSpeechRecognition?: SpeechRecognitionConstructor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const STT_SUPPORTED = speechRecognitionCtor() !== null;
export const TTS_SUPPORTED = typeof window !== 'undefined' && 'speechSynthesis' in window;

const STOP_WORDS = ['stop', 'cancel', 'stop that', 'cancel that', 'halt'];

export class VoiceController {
  private options: VoiceControllerOptions;
  private status: VoiceStatus = 'unavailable';

  private audioContext: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private analyzer: AudioAnalyzer | null = null;
  private raf = 0;
  private driveSmoother = new SmoothedDrive();
  private lastDrive: NeuralAudioDrive = { ...NO_AUDIO_DRIVE };

  private recognition: SpeechRecognitionLike | null = null;
  private recognitionActive = false;
  private handsFree = false;

  private utterance: SpeechSynthesisUtterance | null = null;
  private envelope = 0;
  private speakingSince = 0;

  constructor(options: VoiceControllerOptions) {
    this.options = options;
    this.status = TTS_SUPPORTED || STT_SUPPORTED ? 'idle' : 'unavailable';
  }

  setHandsFreeMode(enabled: boolean): void {
    this.handsFree = enabled;
    if (enabled && this.status === 'idle') {
      void this.startListening();
    }
  }

  get isHandsFree(): boolean {
    return this.handsFree;
  }

  get currentStatus(): VoiceStatus {
    return this.status;
  }

  get sttAvailable(): boolean {
    return STT_SUPPORTED;
  }

  get ttsAvailable(): boolean {
    return TTS_SUPPORTED;
  }

  /* ---------------- microphone + analyzer ---------------- */

  async startListening(): Promise<boolean> {
    if (this.status === 'listening') return true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      this.stream = stream;
      this.audioContext = new AudioContext();
      const source = this.audioContext.createMediaStreamSource(stream);
      this.analyser = this.audioContext.createAnalyser();
      source.connect(this.analyser);
      this.analyzer = new AudioAnalyzer(this.analyser);
      await this.audioContext.resume();
      this.setStatus('listening');
      this.startDriveLoop();
      this.startRecognition();
      return true;
    } catch (error) {
      const message =
        error instanceof DOMException && error.name === 'NotAllowedError'
          ? 'Microphone permission denied — grant access to talk to KERAI.'
          : 'Microphone unavailable — voice is off, typing still works.';
      this.options.onError(message);
      this.setStatus(this.status === 'speaking' ? 'speaking' : 'idle');
      return false;
    }
  }

  stopListening(): void {
    this.stopDriveLoop();
    this.stopRecognition();
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    if (this.audioContext) {
      void this.audioContext.close().catch(() => undefined);
      this.audioContext = null;
    }
    this.analyzer = null;
    this.analyser = null;
    if (this.status === 'listening') this.setStatus('idle');
  }

  /* ---------------- speech recognition (STT) ---------------- */

  private startRecognition(): void {
    const Ctor = speechRecognitionCtor();
    if (!Ctor || this.recognitionActive) return;
    const recognition = new Ctor();
    recognition.continuous = false;
    recognition.interimResults = true;
    const savedLang = typeof localStorage !== 'undefined' ? localStorage.getItem('kerai.voiceLanguage') : null;
    recognition.lang = savedLang ?? 'en-US';
    recognition.onresult = (event) => {
      let transcript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) transcript = result[0].transcript.trim();
      }
      if (!transcript) return;
      this.stopListening();
      // Voice interruption: "stop"/"cancel" halts speech or active mission.
      const lowered = transcript.toLowerCase();
      if (STOP_WORDS.some(word => lowered.includes(word))) {
        this.interrupt();
        this.options.onError('Stopped.');
        return;
      }
      this.options.onTranscript(transcript);
    };
    recognition.onerror = (event) => {
      if (event.error === 'no-speech' || event.error === 'aborted') {
        if (this.handsFree && (this.status === 'listening' || this.status === 'idle')) {
          setTimeout(() => {
            if (this.handsFree && this.status !== 'speaking') void this.startListening();
          }, 300);
        }
        return;
      }
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        this.stopListening();
        this.options.onError('Speech recognition unavailable — mic still drives Neural Core.');
      }
    };
    recognition.onend = () => {
      this.recognitionActive = false;
      if (this.handsFree && (this.status === 'listening' || this.status === 'idle')) {
        setTimeout(() => {
          if (this.handsFree && this.status !== 'speaking') void this.startListening();
        }, 300);
      }
    };
    this.recognition = recognition;
    this.recognitionActive = true;
    try {
      recognition.start();
    } catch {
      this.recognitionActive = false;
    }
  }

  private stopRecognition(): void {
    if (this.recognition && this.recognitionActive) {
      try {
        this.recognition.stop();
      } catch {
        /* already stopped */
      }
    }
    this.recognition = null;
    this.recognitionActive = false;
  }

  private audioElement: HTMLAudioElement | null = null;

  /* ---------------- speech synthesis (TTS) ---------------- */

  speak(text: string, customLang?: string, customVoice?: string, customRate?: number, customPitch?: number): void {
    if (!text.trim()) return;
    if (this.status === 'listening') this.stopListening();
    this.stopSpeaking();

    const lang = customLang ?? (typeof localStorage !== 'undefined' ? localStorage.getItem('kerai.voiceLanguage') ?? 'en-US' : 'en-US');
    const engine = typeof localStorage !== 'undefined' ? localStorage.getItem('kerai.voiceEngine') ?? 'neural' : 'neural';
    const langCode = lang.split('-')[0];

    // Attempt Human Neural Voice streaming if engine is set to 'neural'
    if (engine === 'neural') {
      try {
        const audioUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text.slice(0, 300))}&tl=${langCode}&client=tw-ob`;
        const audio = new Audio(audioUrl);
        this.audioElement = audio;

        this.speakingSince = performance.now();
        this.envelope = 0.8;
        this.setStatus('speaking');

        audio.onplay = () => {
          this.envelope = 1;
        };

        audio.onended = () => {
          this.audioElement = null;
          this.envelope = 0;
          this.setStatus('idle');
          this.options.onDrive({ ...NO_AUDIO_DRIVE });
          if (this.handsFree) {
            setTimeout(() => {
              if (this.handsFree && this.status === 'idle') void this.startListening();
            }, 300);
          }
        };

        let failed = false;
        const handleFallback = () => {
          if (failed) return;
          failed = true;
          if (this.audioElement) {
            this.audioElement.pause();
            this.audioElement = null;
          }
          this.setStatus('idle');
          this.speakFallbackSystem(text, lang, customVoice, customRate, customPitch);
        };

        audio.onerror = handleFallback;

        const playPromise = audio.play();
        if (playPromise !== undefined) {
          playPromise.catch(handleFallback);
        }
        this.startDriveLoop();
        return;
      } catch {
        // Fallback to system voices if neural stream fails
      }
    }

    this.speakFallbackSystem(text, lang, customVoice, customRate, customPitch);
  }

  private speakFallbackSystem(text: string, lang: string, customVoice?: string, customRate?: number, customPitch?: number): void {
    if (!TTS_SUPPORTED) return;
    window.speechSynthesis.cancel();

    const voiceName = customVoice ?? (typeof localStorage !== 'undefined' ? localStorage.getItem('kerai.voiceName') ?? undefined : undefined);
    const rateStr = customRate ?? (typeof localStorage !== 'undefined' ? localStorage.getItem('kerai.voiceRate') : null);
    const pitchStr = customPitch ?? (typeof localStorage !== 'undefined' ? localStorage.getItem('kerai.voicePitch') : null);

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    utterance.rate = rateStr ? parseFloat(String(rateStr)) : 0.95;
    utterance.pitch = pitchStr ? parseFloat(String(pitchStr)) : 1.0;
    utterance.volume = 1;

    const matchedVoice = findBestVoice(lang, voiceName);
    if (matchedVoice) utterance.voice = matchedVoice;

    this.speakingSince = performance.now();
    this.envelope = 0;
    utterance.onboundary = () => {
      this.envelope = 1;
    };
    utterance.onend = () => {
      this.utterance = null;
      this.envelope = 0;
      this.setStatus('idle');
      this.options.onDrive({ ...NO_AUDIO_DRIVE });
      if (this.handsFree) {
        setTimeout(() => {
          if (this.handsFree && this.status === 'idle') void this.startListening();
        }, 300);
      }
    };
    utterance.onerror = () => {
      this.utterance = null;
      this.envelope = 0;
      this.setStatus('idle');
    };

    this.utterance = utterance;
    this.setStatus('speaking');
    window.speechSynthesis.speak(utterance);
    this.startDriveLoop();
  }

  stopSpeaking(): void {
    if (this.audioElement) {
      this.audioElement.pause();
      this.audioElement = null;
    }
    if (TTS_SUPPORTED) window.speechSynthesis.cancel();
    this.utterance = null;
    this.envelope = 0;
    if (this.status === 'speaking') {
      this.setStatus('idle');
      this.options.onDrive({ ...NO_AUDIO_DRIVE });
    }
  }

  /** First-class interruption: halt speech and, if listening, the mic too. */
  interrupt(): void {
    this.stopSpeaking();
    if (this.status === 'listening') this.stopListening();
  }

  dispose(): void {
    this.stopDriveLoop();
    this.stopRecognition();
    this.stopSpeaking();
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    if (this.audioContext) {
      void this.audioContext.close().catch(() => undefined);
      this.audioContext = null;
    }
  }

  /* ---------------- drive loop (analyzer → core) ---------------- */

  private startDriveLoop(): void {
    if (this.raf) return;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
      last = now;

      if (this.analyzer) {
        this.lastDrive = this.driveSmoother.push(this.analyzer.toDrive(dt), dt, 7);
      } else if (this.status === 'speaking') {
        // TTS envelope: boundary-driven pulses with natural decay.
        const elapsed = (now - this.speakingSince) / 1000;
        this.envelope *= Math.exp(-dt / 0.28);
        const pulse = this.envelope * Math.max(0, Math.sin(Math.min(1, elapsed * 2) * Math.PI) * 0.85);
        this.lastDrive = this.driveSmoother.push(
          {
            scale: 0.28 + pulse * 0.5,
            inner: 0.24 + pulse * 0.5,
            deform: 0.24 + pulse * 0.6,
            strand: 0.3 + pulse * 0.55,
            density: 0.32 + pulse * 0.5,
          },
          dt,
          5,
        );
      } else {
        this.lastDrive = this.driveSmoother.push({ ...NO_AUDIO_DRIVE }, dt, 3);
      }
      this.options.onDrive(this.lastDrive);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private stopDriveLoop(): void {
    if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
    if (this.status === 'listening') {
      this.lastDrive = { ...NO_AUDIO_DRIVE };
      this.options.onDrive({ ...NO_AUDIO_DRIVE });
    }
  }

  private setStatus(status: VoiceStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.options.onStatusChange(status);
  }
}
