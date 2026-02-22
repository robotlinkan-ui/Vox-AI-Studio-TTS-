/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { 
  Mic2, 
  Download, 
  Play, 
  Pause, 
  Volume2, 
  Settings2, 
  History, 
  User, 
  Sparkles,
  ChevronDown,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Upload,
  Globe,
  Repeat,
  LogOut
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI, Modality } from "@google/genai";

// Utility to convert raw PCM base64 from Gemini to a playable WAV URL
const createWavUrl = (base64: string, sampleRate = 24000): string => {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  const buffer = new ArrayBuffer(44 + bytes.length);
  const view = new DataView(buffer);
  const writeString = (offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + bytes.length, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, bytes.length, true);
  const pcmData = new Uint8Array(buffer, 44);
  pcmData.set(bytes);
  const blob = new Blob([buffer], { type: 'audio/wav' });
  return URL.createObjectURL(blob);
};

// Available voices in Gemini TTS
const VOICES = [
  { id: 'Puck', name: 'VoxAI Frank (Friend Style)', description: 'A highly realistic, casual, and friendly conversational voice, exactly like an ElevenLabs Friend Character. Speaks naturally with perfect pacing, warm tone, and engaging delivery.', gender: 'Male', tags: ['friendly', 'podcast', 'casual', 'elevenlabs'] },
  { id: 'Charon', name: 'VoxAI Marcus (Corporate)', description: 'Clear, professional, and steady. Perfect for corporate presentations.', gender: 'Male', tags: ['Corporate', 'Normal'] },
  { id: 'Fenrir', name: 'VoxAI Palit (Documentary)', description: 'World-class documentary voice. Deep, emotional, perfect pacing, and highly engaging.', gender: 'Male', tags: ['Documentary', 'Emotional', 'Premium'] },
  { id: 'Kore', name: 'VoxAI Sarah (Cheerful)', description: 'Bright, energetic, and friendly. Great for ads and social media.', gender: 'Female', tags: ['Ad', 'Social'] },
  { id: 'Zephyr', name: 'VoxAI Luna (Soft)', description: 'Calm, soothing, and gentle. Perfect for meditation or ASMR.', gender: 'Female', tags: ['Meditation', 'ASMR'] },
];

interface HistoryItem {
  id: string;
  text: string;
  voice: string;
  audioUrl: string;
  timestamp: number;
}

export default function App() {
  const [text, setText] = useState('');
  const [selectedVoice, setSelectedVoice] = useState(VOICES[0]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showMonetization, setShowMonetization] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const [speed, setSpeed] = useState(1.0);
  const [pitch, setPitch] = useState(1.0);
  const [previewingVoice, setPreviewingVoice] = useState<string | null>(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  
  // New Features State
  const [mode, setMode] = useState<'tts' | 'voice_changer' | 'dubbing'>('tts');
  const [uploadedAudio, setUploadedAudio] = useState<{ file: File, base64: string, mimeType: string } | null>(null);
  const [targetLanguage, setTargetLanguage] = useState('Hindi');
  
  const [loadingStatus, setLoadingStatus] = useState<string | null>(null);
  const [user, setUser] = useState<{ email: string, credits: number, isPremium: boolean } | null>(null);
  
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const MAX_CHARS = 20000;

  // Fetch user on load
  useEffect(() => {
    fetch('/api/user')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data && !data.error) {
          setUser(data);
        } else {
          setUser(null);
        }
      })
      .catch(() => {
        setUser(null);
      });
  }, []);

  // Listen for OAuth success
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        fetch('/api/user')
          .then(res => res.json())
          .then(data => setUser(data))
          .catch(console.error);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleLogin = async () => {
    try {
      const res = await fetch('/api/auth/url');
      const { url } = await res.json();
      window.open(url, 'oauth_popup', 'width=600,height=700');
    } catch (err) {
      console.error("Login failed", err);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      setUser(null);
      // Optional: Clear history or reset state
      setHistory([]);
      setAudioUrl(null);
    } catch (err) {
      console.error("Logout failed", err);
    }
  };

  const filteredVoices = VOICES.filter(v => 
    v.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    v.tags.some(t => t.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    // 50MB limit
    if (file.size > 50 * 1024 * 1024) {
      setError("File size exceeds 50MB limit.");
      return;
    }
    
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = (reader.result as string).split(',')[1];
      setUploadedAudio({ file, base64: base64String, mimeType: file.type });
    };
    reader.readAsDataURL(file);
  };

  const playVoicePreview = async (voice: typeof VOICES[0]) => {
    if (previewingVoice === voice.id) return;
    setPreviewingVoice(voice.id);
    
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: "Hello, this is a preview of my voice." }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: voice.id },
            },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (base64Audio) {
        const url = createWavUrl(base64Audio);
        if (previewAudioRef.current) {
          previewAudioRef.current.src = url;
          previewAudioRef.current.play();
        }
      }
    } catch (err) {
      console.error("Preview failed", err);
    } finally {
      setTimeout(() => setPreviewingVoice(null), 2000);
    }
  };

  const generateSpeech = async () => {
    if (!user) {
      handleLogin();
      return;
    }

    let processingText = text;

    // Handle Voice Changer & Dubbing modes
    if (mode !== 'tts') {
      if (!uploadedAudio) {
        setError("Please upload an audio file first.");
        return;
      }
      setIsGenerating(true);
      setLoadingStatus(mode === 'dubbing' ? 'Translating audio...' : 'Analyzing audio...');
      setError(null);
      try {
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        const prompt = mode === 'dubbing' 
          ? `Translate the speech in this audio to ${targetLanguage}. Return ONLY the translated text, nothing else.` 
          : `Transcribe the speech in this audio exactly. Return ONLY the transcription, nothing else.`;
          
        const textResponse = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: [
            { parts: [
              { inlineData: { data: uploadedAudio.base64, mimeType: uploadedAudio.mimeType } },
              { text: prompt }
            ]}
          ]
        });
        
        processingText = textResponse.text || '';
        if (!processingText.trim()) throw new Error("Could not extract speech from audio.");
        
        // Update the text area so the user sees what was generated (optional, but good for transparency)
        setText(processingText);
      } catch (err: any) {
        console.error(err);
        setError("Failed to process audio file. " + err.message);
        setIsGenerating(false);
        setLoadingStatus(null);
        return;
      }
    }

    if (!processingText.trim()) {
      setError("Text is empty.");
      setIsGenerating(false);
      setLoadingStatus(null);
      return;
    }

    if (processingText.length > MAX_CHARS) {
      setError(`Text exceeds the ${MAX_CHARS} character limit.`);
      setIsGenerating(false);
      setLoadingStatus(null);
      return;
    }

    if (user.credits !== Infinity && user.credits < processingText.length) {
      setError(`Insufficient credits. You need ${processingText.length} credits but have ${user.credits}. Please upgrade to Premium.`);
      setShowMonetization(true);
      setIsGenerating(false);
      setLoadingStatus(null);
      return;
    }
    
    setIsGenerating(true);
    setLoadingStatus('Generating AI voice...');
    setError(null);
    
    abortControllerRef.current = new AbortController();
    
    try {
      // Re-initialize to ensure fresh API key
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      // Pass the pure text to the TTS model to avoid hallucinations, weird noises, or reading instructions aloud
      const responsePromise = ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: processingText }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: selectedVoice.id },
            },
          },
        },
      });

      // Implement a race between the API call and the abort signal
      const response = await Promise.race([
        responsePromise,
        new Promise<any>((_, reject) => {
          if (abortControllerRef.current?.signal.aborted) {
            reject(new Error('AbortError'));
          }
          abortControllerRef.current?.signal.addEventListener('abort', () => {
            reject(new Error('AbortError'));
          });
        })
      ]);

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      
      if (base64Audio) {
        // Deduct credits
        if (user.credits !== Infinity) {
          fetch('/api/user/deduct', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ amount: processingText.length })
          }).then(res => res.json()).then(data => setUser(data)).catch(console.error);
        }

        const url = createWavUrl(base64Audio);
        setAudioUrl(url);
        
        const newItem: HistoryItem = {
          id: Math.random().toString(36).substr(2, 9),
          text: processingText.length > 80 ? processingText.substring(0, 80) + '...' : processingText,
          voice: selectedVoice.name,
          audioUrl: url,
          timestamp: Date.now(),
        };
        setHistory(prev => [newItem, ...prev]);
        
        // Auto-play for "Fast" feel
        setTimeout(() => {
          if (audioRef.current) {
            audioRef.current.playbackRate = speed; // Apply speed to player
            audioRef.current.play();
            setIsPlaying(true);
          }
        }, 50);
      } else {
        throw new Error("The AI model returned an empty response. Please try again with shorter text or a different voice.");
      }
    } catch (err: any) {
      if (err.name === 'AbortError' || err.message?.includes('abort')) {
        console.log("Generation cancelled by user.");
        return;
      }
      console.error("Generation Error:", err);
      if (err.message && (err.message.includes("429") || err.message.includes("RESOURCE_EXHAUSTED") || err.message.includes("quota"))) {
        setError("API Quota Exceeded (429): Your API key has reached its limit. Please wait a minute or check your Google Cloud billing.");
      } else {
        setError(err.message || "Connection failed. Please check your internet or API key.");
      }
    } finally {
      setIsGenerating(false);
      setLoadingStatus(null);
      abortControllerRef.current = null;
    }
  };

  const handleCancel = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsGenerating(false);
      setLoadingStatus(null);
    }
  };

  const downloadAudio = (url: string, filename: string) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}.mp3`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const togglePlay = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-bottom border-white/5 py-4 px-6 flex items-center justify-between sticky top-0 bg-[#050505]/80 backdrop-blur-md z-50">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center">
            <Mic2 className="text-black w-6 h-6" />
          </div>
          <span className="text-xl font-bold tracking-tight">Vox AI Studio TTS</span>
        </div>
        
        <div className="flex items-center gap-4">
          <button 
            onClick={() => setShowMonetization(!showMonetization)}
            className="hidden md:flex items-center gap-2 px-4 py-2 bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 rounded-xl hover:bg-yellow-500/20 transition-all"
          >
            <Sparkles className="w-4 h-4" />
            <span>Premium Plans</span>
          </button>
          
          {user ? (
            <div className="hidden md:flex items-center gap-4 px-4 py-1.5 glass-panel text-sm">
              <div className="flex items-center gap-2 border-r border-white/10 pr-4">
                <span className="opacity-60">Credits:</span>
                <span className="font-mono font-bold text-emerald-400">
                  {user.credits === Infinity ? 'Unlimited' : user.credits.toLocaleString()}
                </span>
              </div>
              <div className="flex items-center gap-2 border-r border-white/10 pr-4">
                <User className="w-4 h-4 opacity-60" />
                <span className="max-w-[120px] truncate">{user.email}</span>
                {user.email === 'robotlinkan@gmail.com' ? (
                  <span className="px-2 py-0.5 bg-purple-500/20 text-purple-400 text-[10px] uppercase tracking-wider rounded-full border border-purple-500/30 font-bold" title="Chief Owner: Robot Linkan">Chief Owner</span>
                ) : user.email === 'sachinamliyar15@gmail.com' ? (
                  <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-400 text-[10px] uppercase tracking-wider rounded-full border border-emerald-500/30 font-bold" title="Owner: Sachin Amliyar">Owner</span>
                ) : user.isPremium ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" title="Premium User" />
                ) : null}
              </div>
              <button 
                onClick={handleLogout}
                className="flex items-center gap-1.5 text-red-400 hover:text-red-300 transition-colors"
                title="Logout"
              >
                <LogOut className="w-4 h-4" />
                <span className="hidden lg:inline">Logout</span>
              </button>
            </div>
          ) : (
            <button 
              onClick={handleLogin}
              className="hidden md:flex items-center gap-2 px-4 py-1.5 bg-white text-black rounded-xl hover:bg-white/90 font-medium text-sm transition-all"
            >
              <User className="w-4 h-4" />
              <span>Sign in with Google</span>
            </button>
          )}
        </div>
      </header>

      <main className="flex-1 max-w-6xl mx-auto w-full p-6 grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column: Editor */}
        <div className="lg:col-span-8 space-y-6">
          {/* Mode Selector */}
          <div className="flex gap-2 p-1 bg-white/5 rounded-xl w-fit">
            <button 
              onClick={() => setMode('tts')} 
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${mode === 'tts' ? 'bg-white/10 text-white' : 'text-white/50 hover:text-white/80'}`}
            >
              <Mic2 className="w-4 h-4" /> Text to Speech
            </button>
            <button 
              onClick={() => setMode('voice_changer')} 
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${mode === 'voice_changer' ? 'bg-white/10 text-white' : 'text-white/50 hover:text-white/80'}`}
            >
              <Repeat className="w-4 h-4" /> Voice Changer
            </button>
            <button 
              onClick={() => setMode('dubbing')} 
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${mode === 'dubbing' ? 'bg-white/10 text-white' : 'text-white/50 hover:text-white/80'}`}
            >
              <Globe className="w-4 h-4" /> AI Dubbing
            </button>
          </div>

          <div className="glass-panel p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-yellow-500" />
                {mode === 'tts' ? 'Text to Speech' : mode === 'voice_changer' ? 'Voice Changer (Speech-to-Speech)' : 'AI Dubbing (Translate Audio)'}
              </h2>
              {mode === 'tts' && (
                <span className="text-xs opacity-40 font-mono uppercase tracking-widest">
                  {text.length} / {MAX_CHARS} characters
                </span>
              )}
            </div>
            
            {mode === 'tts' ? (
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Type or paste your text here to generate a high-quality AI voice..."
                className="w-full h-64 bg-transparent border-none resize-none focus:ring-0 text-lg leading-relaxed placeholder:opacity-20"
              />
            ) : (
              <div className="space-y-4">
                <div className="w-full h-48 border-2 border-dashed border-white/10 rounded-xl flex flex-col items-center justify-center gap-4 hover:border-emerald-500/50 transition-colors relative bg-black/20">
                  <input type="file" accept="audio/*" onChange={handleFileUpload} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                  <Upload className="w-8 h-8 opacity-40" />
                  <div className="text-center">
                    <p className="font-medium">{uploadedAudio ? uploadedAudio.file.name : 'Click or drag audio file to upload'}</p>
                    <p className="text-xs opacity-40 mt-1">MP3, WAV, M4A up to 50MB</p>
                  </div>
                </div>
                
                {mode === 'dubbing' && (
                  <div className="flex items-center gap-4 p-4 bg-white/5 rounded-xl border border-white/10">
                    <Globe className="w-5 h-5 opacity-60" />
                    <div className="flex-1">
                      <label className="text-xs opacity-60 uppercase tracking-wider block mb-1">Target Language</label>
                      <select 
                        value={targetLanguage} 
                        onChange={e => setTargetLanguage(e.target.value)} 
                        className="bg-transparent border-none text-white outline-none w-full font-medium"
                      >
                        <option value="Hindi" className="bg-black">Hindi</option>
                        <option value="English" className="bg-black">English</option>
                        <option value="Gujarati" className="bg-black">Gujarati</option>
                        <option value="Marathi" className="bg-black">Marathi</option>
                        <option value="Bengali" className="bg-black">Bengali</option>
                        <option value="Tamil" className="bg-black">Tamil</option>
                        <option value="Telugu" className="bg-black">Telugu</option>
                        <option value="Urdu" className="bg-black">Urdu</option>
                        <option value="Malayalam" className="bg-black">Malayalam</option>
                        <option value="Kannada" className="bg-black">Kannada</option>
                        <option value="Punjabi" className="bg-black">Punjabi</option>
                        <option value="Spanish" className="bg-black">Spanish</option>
                        <option value="French" className="bg-black">French</option>
                        <option value="German" className="bg-black">German</option>
                        <option value="Italian" className="bg-black">Italian</option>
                        <option value="Portuguese" className="bg-black">Portuguese</option>
                        <option value="Arabic" className="bg-black">Arabic</option>
                        <option value="Japanese" className="bg-black">Japanese</option>
                        <option value="Korean" className="bg-black">Korean</option>
                        <option value="Mandarin" className="bg-black">Mandarin</option>
                      </select>
                    </div>
                  </div>
                )}
                
                {text && (
                  <div className="p-4 bg-white/5 rounded-xl border border-white/10">
                    <p className="text-xs opacity-60 mb-2 uppercase tracking-wider">Extracted/Translated Text:</p>
                    <p className="text-sm opacity-80">{text}</p>
                  </div>
                )}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-4 pt-4 border-t border-white/5">
              <div className="flex flex-wrap items-center gap-4">
                <div className="relative">
                  <button 
                    onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                    className="flex items-center gap-2 px-4 py-2 glass-panel hover:bg-white/10 transition-colors"
                  >
                    <Volume2 className="w-4 h-4" />
                    <span>{selectedVoice.name}</span>
                    <ChevronDown className={`w-4 h-4 opacity-40 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`} />
                  </button>
                  
                  <AnimatePresence>
                    {isDropdownOpen && (
                      <motion.div 
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 10 }}
                        className="absolute bottom-full left-0 mb-2 w-80 glass-panel p-2 z-[60]"
                      >
                        <div className="p-2 border-b border-white/5 sticky top-0 bg-[#0a0a0a] z-10">
                          <input 
                            type="text" 
                            placeholder="Search voices..." 
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500/50"
                            onClick={(e) => e.stopPropagation()}
                          />
                        </div>
                        <div className="max-h-80 overflow-y-auto space-y-1 p-2">
                          {filteredVoices.map((voice) => (
                            <div key={voice.name} className="flex items-center gap-1">
                              <button
                                onClick={() => {
                                  setSelectedVoice(voice);
                                  setIsDropdownOpen(false);
                                }}
                                className={`flex-1 text-left p-3 rounded-lg transition-colors ${
                                  selectedVoice.name === voice.name ? 'bg-white text-black' : 'hover:bg-white/5'
                                }`}
                              >
                                <div className="flex justify-between items-center mb-1">
                                  <span className="font-semibold">{voice.name}</span>
                                  <span className="text-[10px] uppercase tracking-wider opacity-60">{voice.gender}</span>
                                </div>
                                <p className={`text-xs ${selectedVoice.name === voice.name ? 'text-black/70' : 'opacity-60'}`}>
                                  {voice.description}
                                </p>
                              </button>
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  playVoicePreview(voice);
                                }}
                                className={`p-3 rounded-lg hover:bg-white/10 transition-colors ${previewingVoice === voice.id ? 'animate-pulse text-emerald-400' : 'opacity-40'}`}
                                title="Preview Voice"
                              >
                                <Play className="w-4 h-4 fill-current" />
                              </button>
                            </div>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Speed & Pitch Controls */}
                <div className="flex items-center gap-6 px-4 py-2 glass-panel">
                  <div className="flex flex-col gap-1 w-24">
                    <div className="flex justify-between text-[10px] uppercase tracking-widest opacity-40">
                      <span>Speed</span>
                      <span>{speed}x</span>
                    </div>
                    <input 
                      type="range" min="0.5" max="2.0" step="0.1" 
                      value={speed} onChange={(e) => setSpeed(parseFloat(e.target.value))}
                      className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-white"
                    />
                  </div>
                  <div className="flex flex-col gap-1 w-24">
                    <div className="flex justify-between text-[10px] uppercase tracking-widest opacity-40">
                      <span>Pitch</span>
                      <span>{pitch}x</span>
                    </div>
                    <input 
                      type="range" min="0.5" max="2.0" step="0.1" 
                      value={pitch} onChange={(e) => setPitch(parseFloat(e.target.value))}
                      className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-white"
                    />
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={generateSpeech}
                  disabled={isGenerating || (mode === 'tts' ? !text.trim() : !uploadedAudio)}
                  className="btn-primary flex items-center gap-2"
                >
                  {isGenerating ? (
                    <>
                      <div className="w-4 h-4 border-2 border-black/20 border-t-black rounded-full animate-spin" />
                      {loadingStatus || 'Processing...'}
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4 fill-current" />
                      {mode === 'tts' ? 'Generate Voice' : 'Process Audio'}
                    </>
                  )}
                </button>
                
                {isGenerating && (
                  <button
                    onClick={handleCancel}
                    className="px-4 py-3 bg-red-500/10 text-red-500 border border-red-500/20 rounded-xl hover:bg-red-500/20 transition-all font-medium flex items-center gap-2"
                  >
                    <div className="w-4 h-4 bg-red-500 rounded-sm" />
                    Stop
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Player Section */}
          <AnimatePresence>
            {audioUrl && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="glass-panel p-6 bg-white/10 border-white/20"
              >
                <div className="flex items-center gap-6">
                  <button
                    onClick={togglePlay}
                    className="w-14 h-14 bg-white text-black rounded-full flex items-center justify-center hover:scale-105 transition-transform active:scale-95"
                  >
                    {isPlaying ? <Pause className="w-6 h-6 fill-current" /> : <Play className="w-6 h-6 fill-current ml-1" />}
                  </button>
                  
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-semibold">{selectedVoice.name}</span>
                      <span className="text-xs opacity-60">Generated just now</span>
                    </div>
                    <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                      <motion.div 
                        className="h-full bg-white"
                        animate={{ width: isPlaying ? '100%' : '0%' }}
                        transition={{ duration: 5, ease: "linear" }}
                      />
                    </div>
                  </div>

                  <button
                    onClick={() => downloadAudio(audioUrl, `voxai-${selectedVoice.name.toLowerCase()}`)}
                    className="p-3 glass-panel hover:bg-white/10 transition-colors"
                    title="Download MP3"
                  >
                    <Download className="w-5 h-5" />
                  </button>
                </div>
                <audio 
                  ref={audioRef} 
                  src={audioUrl} 
                  onEnded={() => setIsPlaying(false)}
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  className="hidden" 
                />
                <audio ref={previewAudioRef} className="hidden" />
              </motion.div>
            )}
          </AnimatePresence>

          {error && (
            <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-3 text-red-400">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <p className="text-sm">{error}</p>
            </div>
          )}
        </div>

        {/* Right Column: History */}
        <div className="lg:col-span-4 space-y-6">
          <div className="glass-panel p-6 h-full flex flex-col">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <History className="w-5 h-5 opacity-60" />
                History
              </h2>
              <button 
                onClick={() => setHistory([])}
                className="p-2 hover:bg-red-500/10 hover:text-red-400 rounded-lg transition-colors"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-3 pr-2 custom-scrollbar">
              {history.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center opacity-20 text-center py-20">
                  <History className="w-12 h-12 mb-4" />
                  <p>No history yet</p>
                </div>
              ) : (
                history.map((item) => (
                  <motion.div
                    key={item.id}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="p-3 rounded-xl bg-white/5 border border-white/5 hover:border-white/10 transition-all group"
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <p className="text-xs line-clamp-2 opacity-80">{item.text}</p>
                      <button 
                        onClick={() => downloadAudio(item.audioUrl, `voxai-history-${item.id}`)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-white/10 rounded"
                      >
                        <Download className="w-3 h-3" />
                      </button>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-medium px-1.5 py-0.5 bg-white/10 rounded uppercase tracking-wider">
                        {item.voice}
                      </span>
                      <span className="text-[10px] opacity-40">
                        {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </motion.div>
                ))
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Monetization Modal */}
      <AnimatePresence>
        {showMonetization && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-6"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="glass-panel max-w-2xl w-full p-8 space-y-6 bg-[#0a0a0a]"
            >
              <div className="flex justify-between items-start">
                <div>
                  <h2 className="text-2xl font-bold">Monetization & Control</h2>
                  <p className="opacity-60">How to earn from your VoxAI Studio</p>
                </div>
                <button onClick={() => setShowMonetization(false)} className="p-2 hover:bg-white/10 rounded-full">
                  <Trash2 className="w-6 h-6 rotate-45" />
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 rounded-xl bg-white/5 border border-white/10 space-y-2">
                  <div className="w-10 h-10 bg-emerald-500/20 rounded-lg flex items-center justify-center mb-2">
                    <Sparkles className="text-emerald-400 w-6 h-6" />
                  </div>
                  <h3 className="font-semibold">Subscription Plans</h3>
                  <p className="text-xs opacity-60">Charge users monthly for higher character limits (e.g., $19/mo for 100k chars).</p>
                </div>
                <div className="p-4 rounded-xl bg-white/5 border border-white/10 space-y-2">
                  <div className="w-10 h-10 bg-blue-500/20 rounded-lg flex items-center justify-center mb-2">
                    <User className="text-blue-400 w-6 h-6" />
                  </div>
                  <h3 className="font-semibold">Pay-Per-Use</h3>
                  <p className="text-xs opacity-60">Sell "Character Packs" (e.g., $5 for 50,000 characters).</p>
                </div>
              </div>

              <div className="space-y-4 pt-4 border-t border-white/5">
                <h3 className="font-semibold">Next Steps for Income:</h3>
                <ul className="space-y-2 text-sm opacity-80">
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    <span>Integrate <b>Stripe</b> for payments.</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    <span>Add <b>User Authentication</b> (Login/Signup).</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    <span>Set up a <b>Database</b> to track user balances.</span>
                  </li>
                </ul>
              </div>

              <button 
                onClick={() => setShowMonetization(false)}
                className="w-full btn-primary"
              >
                I Understand, Let's Build!
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Footer */}
      <footer className="py-6 px-6 border-t border-white/5 text-center">
        <p className="text-xs opacity-40">
          Powered by Gemini 2.5 TTS Engine â€¢ Dedicated to sachinamliyar15@gmail.com
        </p>
      </footer>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.1);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.2);
        }
      `}</style>
    </div>
  );
}
