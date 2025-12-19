import React, { useState, useRef, useEffect } from 'react';
import { GeneratedSection, ExerciseType } from '../types';
import { Volume2, CheckCircle2, XCircle, BookOpen, Brain, Mic, Image as ImageIcon, Mic2 } from 'lucide-react';
import { evaluatePronunciation, PronunciationFeedback } from '../services/geminiService';

interface ExerciseCardProps {
  section: GeneratedSection;
  sectionIndex: number;
  showAnswersGlobal: boolean;
  userAnswers: Record<string, string>;
  onAnswerSelect: (sectionIdx: number, questionIdx: number, option: string) => void;
  isSubmitted: boolean;
  baseQuestionIndex?: number;
}

const ExerciseCard: React.FC<ExerciseCardProps> = ({ 
  section, 
  sectionIndex,
  showAnswersGlobal,
  userAnswers,
  onAnswerSelect,
  isSubmitted,
  baseQuestionIndex = 0
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  
  // Icons mapping
  const getIcon = () => {
    switch(section.type) {
      case ExerciseType.GRAMMAR: return <Brain className="w-5 h-5" />;
      case ExerciseType.READING: return <BookOpen className="w-5 h-5" />;
      case ExerciseType.LISTENING: return <Volume2 className="w-5 h-5" />;
      case ExerciseType.VOCABULARY: return <ImageIcon className="w-5 h-5" />;
      case ExerciseType.SPEAKING: return <Mic2 className="w-5 h-5" />;
      default: return <BookOpen className="w-5 h-5" />;
    }
  };

  const handlePlayAudio = () => {
    if (!section.contextText) return;
    if (isPlaying) return;

    // Use Web Speech API (built-in, free)
    window.speechSynthesis.cancel();
    
    const utterance = new SpeechSynthesisUtterance(section.contextText);
    
    // Configure speech settings
    utterance.lang = 'en-US';
    utterance.rate = 0.85; // Slightly slower for learning
    utterance.pitch = 1.0;
    utterance.volume = 1.0;
    
    // Event handlers
    utterance.onstart = () => {
      setIsPlaying(true);
      setIsLoadingAudio(false);
    };
    utterance.onend = () => setIsPlaying(false);
    utterance.onerror = () => {
      setIsPlaying(false);
      setIsLoadingAudio(false);
      alert("Could not generate audio at this time.");
    };
    
    setIsLoadingAudio(true);
    window.speechSynthesis.speak(utterance);
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden mb-8">
      {/* Header */}
      <div className="bg-slate-50 px-6 py-4 border-b border-slate-100 flex items-center justify-between">
        <div className="flex items-center gap-2 text-antoree-green font-semibold">
          {getIcon()}
          <span>{section.type}</span>
        </div>
        <span className="text-xs font-mono text-slate-400 bg-slate-200 px-2 py-1 rounded">
          {section.id}
        </span>
      </div>

      <div className="p-6">
        <h3 className="text-xl font-bold text-slate-800 mb-2">{section.title}</h3>
        <p className="text-slate-600 mb-6 italic">{section.instruction}</p>

        {/* Context for Reading (NOT for Listening - each question is independent) */}
        {section.contextText && section.type !== ExerciseType.LISTENING && (
          <div className="mb-8 p-5 bg-slate-50 rounded-xl border border-slate-100">
            <div className="prose prose-slate max-w-none">
              <p className="text-slate-800 leading-relaxed whitespace-pre-line">{section.contextText}</p>
            </div>
          </div>
        )}

        {/* Questions */}
        <div className="space-y-6">
          {section.questions.map((q, idx) => {
            const realIndex = baseQuestionIndex + idx;
            return section.type === ExerciseType.SPEAKING ? (
              <SpeakingQuestion
                key={idx}
                question={q}
                index={realIndex}
                sectionIndex={sectionIndex}
                userSelected={userAnswers[`${sectionIndex}-${realIndex}`]}
                onSelect={(opt) => onAnswerSelect(sectionIndex, realIndex, opt)}
                showAnswer={showAnswersGlobal}
                isSubmitted={isSubmitted}
              />
            ) : (
              <QuestionItem 
                key={idx} 
                question={q} 
                index={realIndex} 
                sectionIndex={sectionIndex}
                sectionType={section.type}
                userSelected={userAnswers[`${sectionIndex}-${realIndex}`]}
                onSelect={(opt) => onAnswerSelect(sectionIndex, realIndex, opt)}
                showAnswer={showAnswersGlobal} 
                isSubmitted={isSubmitted}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
};

interface QuestionItemProps {
  question: any;
  index: number;
  sectionIndex: number;
  sectionType: ExerciseType;
  userSelected: string | undefined;
  onSelect: (option: string) => void;
  showAnswer: boolean;
  isSubmitted: boolean;
}

const QuestionItem: React.FC<QuestionItemProps> = ({ 
  question, 
  index,
  sectionType,
  userSelected, 
  onSelect, 
  showAnswer,
  isSubmitted 
}) => {
  const isCorrect = userSelected === question.correctAnswer;
  const isAnswered = userSelected !== undefined && userSelected !== '';
  const isListening = sectionType === ExerciseType.LISTENING;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const wasPlayingRef = useRef<boolean>(false);
  const shouldResumeRef = useRef<boolean>(false);

  // Track audio playing state for listening exercises
  useEffect(() => {
    if (!isListening || !audioRef.current) return;

    const audio = audioRef.current;

    const handlePlay = () => {
      wasPlayingRef.current = true;
      shouldResumeRef.current = false;
    };

    const handlePause = () => {
      // Only track pause if we didn't intentionally pause it
      if (shouldResumeRef.current && wasPlayingRef.current) {
        // Resume if it was paused unintentionally
        setTimeout(() => {
          if (audio && audio.paused && shouldResumeRef.current) {
            audio.play().catch(() => {
              // Ignore play errors
            });
          }
        }, 10);
      }
    };

    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);

    return () => {
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
    };
  }, [isListening]);

  // Speak option text when clicked (only for non-listening exercises)
  const speakOption = (text: string) => {
    if (isListening) return; // Don't speak for listening exercises
    
    // Cancel any ongoing speech
    window.speechSynthesis.cancel();
    
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.rate = 0.9;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;
    
    window.speechSynthesis.speak(utterance);
  };

  // Convert base64 audio to blob URL for HTML5 audio player (cost-optimized: reuse pre-generated audio)
  const getAudioUrl = () => {
    if (!question.audioData) return undefined;
    
    try {
      // Decode base64 to binary
      const binaryString = atob(question.audioData);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      
      // Create blob with correct MIME type (PCM audio from Gemini)
      // We need to wrap PCM in WAV format for browser compatibility
      const wavBlob = createWavBlob(bytes, 24000, 1);
      return URL.createObjectURL(wavBlob);
    } catch (error) {
      console.error("Failed to create audio URL:", error);
      return undefined;
    }
  };

  // Helper function to create WAV file from PCM data
  const createWavBlob = (pcmData: Uint8Array, sampleRate: number, numChannels: number): Blob => {
    const dataLength = pcmData.length;
    const buffer = new ArrayBuffer(44 + dataLength);
    const view = new DataView(buffer);

    // WAV header
    const writeString = (offset: number, string: string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataLength, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM format
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * 2, true);
    view.setUint16(32, numChannels * 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, dataLength, true);

    // Copy PCM data
    const pcmView = new Uint8Array(buffer, 44);
    pcmView.set(pcmData);

    return new Blob([buffer], { type: 'audio/wav' });
  };

  return (
    <div className="border-b border-slate-100 pb-6 last:border-0 last:pb-0">
      <div className="flex gap-3">
        <span className={`flex-shrink-0 w-8 h-8 rounded-full text-sm font-bold flex items-center justify-center mt-0.5 transition-colors ${
           isSubmitted 
             ? (isCorrect ? 'bg-green-100 text-green-700' : (isAnswered ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'))
             : 'bg-slate-100 text-slate-600'
        }`}>
          {isSubmitted ? (isCorrect ? <CheckCircle2 className="w-5 h-5" /> : (isAnswered ? <XCircle className="w-5 h-5" /> : <span className="text-yellow-700">?</span>)) : index + 1}
        </span>
        <div className="flex-grow">
          {/* Question Text */}
          <p className="font-medium text-slate-800 mb-3 text-lg leading-snug">{question.questionText}</p>

          {/* Generated Image (For Vocabulary & Listening) */}
          {question.questionImage && (
            <div className="mb-6 max-w-sm">
                <div className="rounded-xl overflow-hidden border border-slate-200 shadow-sm relative group bg-slate-50">
                    <img 
                      src={question.questionImage} 
                      alt="Identify this" 
                      className="w-full h-auto object-cover max-h-64"
                    />
                     <div className="absolute bottom-2 right-2 bg-black/60 text-white text-xs px-2 py-1 rounded backdrop-blur-sm flex items-center gap-1">
                        <ImageIcon className="w-3 h-3" />
                        AI Generated
                    </div>
                </div>
            </div>
          )}

          {/* Audio Player for Listening Questions (HTML5 with seek/scrub controls) */}
          {isListening && question.audioData && (
            <div className="mb-6 flex flex-col items-center gap-2">
              <div className="w-full max-w-md bg-gradient-to-r from-antoree-lightGreen to-green-50 p-4 rounded-xl border border-green-200 shadow-sm">
                <div className="flex items-center gap-3 mb-2">
                  <Volume2 className="w-5 h-5 text-antoree-green flex-shrink-0" />
                  <span className="text-sm font-semibold text-green-900">Listening Track</span>
                </div>
                <audio 
                  ref={audioRef}
                  controls 
                  className="w-full"
                  src={getAudioUrl()}
                  preload="metadata"
                >
                  Trình duyệt của bạn không hỗ trợ audio player.
                </audio>
                <div className="mt-2 text-xs text-slate-500 text-center">
                  🎧 Có thể tua, phát lại nhiều lần
                </div>
              </div>
            </div>
          )}
          
          {/* Fallback: Web Speech API if no pre-generated audio */}
          {isListening && !question.audioData && (
            <div className="mb-6 flex justify-center">
              <div className="text-sm text-slate-500 bg-yellow-50 px-4 py-2 rounded-lg border border-yellow-200">
                ⚠️ Audio chưa được tạo cho câu hỏi này
              </div>
            </div>
          )}
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {question.options && question.options.length > 0 && question.options.map((opt: string, i: number) => {
              const isSelected = userSelected === opt;
              const isTheCorrectAnswer = opt === question.correctAnswer;
              
              let buttonClass = "bg-white border-slate-200 hover:bg-slate-50";

              if (isSubmitted || showAnswer) {
                if (isTheCorrectAnswer) {
                  // Always highlight correct answer in green if submitted or showing answers
                  buttonClass = "bg-green-50 border-green-500 text-green-900 ring-1 ring-green-500";
                } else if (isSelected && !isTheCorrectAnswer) {
                  // Highlight wrong selection in red
                  buttonClass = "bg-red-50 border-red-500 text-red-900 ring-1 ring-red-500";
                } else {
                  // Dim others
                  buttonClass = "opacity-50 border-slate-100";
                }
              } else {
                // Interactive state
                if (isSelected) {
                  buttonClass = "bg-antoree-lightGreen border-antoree-green text-antoree-green ring-1 ring-antoree-green";
                }
              }

              // For Listening: hide text unless submitted or showing answers (TOEIC style)
              const showOptionText = !isListening || isSubmitted || showAnswer;

              return (
                <button
                  key={i}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (!isSubmitted) {
                      // For Listening: ensure audio continues playing
                      if (isListening && audioRef.current) {
                        const wasPlaying = !audioRef.current.paused;
                        const currentTime = audioRef.current.currentTime;
                        
                        // Mark that we want to resume if paused
                        if (wasPlaying) {
                          shouldResumeRef.current = true;
                          wasPlayingRef.current = true;
                        }
                        
                        // Select the answer
                        onSelect(opt);
                        
                        // Use setTimeout to ensure audio continues after state update
                        setTimeout(() => {
                          if (audioRef.current && shouldResumeRef.current) {
                            // If audio was playing, restore its state
                            if (wasPlayingRef.current) {
                              // Restore playback position if it changed significantly
                              if (Math.abs(audioRef.current.currentTime - currentTime) > 0.5) {
                                audioRef.current.currentTime = currentTime;
                              }
                              // Resume playback if paused
                              if (audioRef.current.paused) {
                                audioRef.current.play().catch(() => {
                                  // Ignore play errors (user may have paused manually)
                                  shouldResumeRef.current = false;
                                });
                              }
                            }
                          }
                        }, 50);
                      } else {
                        onSelect(opt);
                        // Speak the option when clicked (only for non-listening)
                        speakOption(opt);
                      }
                    }
                  }}
                  onMouseDown={(e) => {
                    // Prevent default to avoid focus issues that might pause audio
                    if (isListening && audioRef.current && !audioRef.current.paused) {
                      e.preventDefault();
                    }
                  }}
                  disabled={isSubmitted || showAnswer}
                  className={`text-left px-5 py-4 border rounded-xl text-base transition-all duration-200 ${buttonClass} ${!showOptionText ? 'justify-center text-center' : ''}`}
                >
                  <span className={`font-semibold ${showOptionText ? 'mr-3' : ''} opacity-60 uppercase`}>
                    {String.fromCharCode(65 + i)}{showOptionText ? '.' : ''}
                  </span>
                  {showOptionText && opt}
                </button>
              );
            })}
          </div>

          {/* Explanation / Result */}
          {(showAnswer || (isSubmitted && (!isCorrect || !isAnswered))) && (
            <div className={`mt-4 p-4 rounded-xl text-sm flex gap-3 ${
              isSubmitted 
                ? (!isAnswered ? 'bg-yellow-50 text-yellow-900 border border-yellow-200' : (!isCorrect ? 'bg-red-50 text-red-900' : 'bg-green-50 text-green-900'))
                : 'bg-blue-50 text-blue-800'
            }`}>
               <div className="mt-0.5 flex-shrink-0">
                 {isSubmitted 
                   ? (!isAnswered ? <span className="text-yellow-700 text-lg">⚠</span> : (!isCorrect ? <XCircle className="w-5 h-5 text-red-600" /> : <CheckCircle2 className="w-5 h-5 text-green-600" />))
                   : <CheckCircle2 className="w-5 h-5 text-blue-600" />
                 }
               </div>
               <div>
                 <span className="font-bold block mb-1">
                    {isSubmitted 
                      ? (!isAnswered ? 'Chưa trả lời. ' : (!isCorrect ? 'Incorrect. ' : ''))
                      : ''
                    }
                    Correct Answer: {question.correctAnswer}
                 </span>
                 {question.explanation}
               </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// Speaking Question Component with Recording
interface SpeakingQuestionProps {
  question: any;
  index: number;
  sectionIndex: number;
  userSelected: string | undefined;
  onSelect: (option: string) => void;
  showAnswer: boolean;
  isSubmitted: boolean;
}

const SpeakingQuestion: React.FC<SpeakingQuestionProps> = ({
  question,
  index,
  userSelected,
  onSelect,
  showAnswer,
  isSubmitted
}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [feedback, setFeedback] = useState<PronunciationFeedback | null>(null);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  
  // For sample audio using Web Speech API
  const [isPlayingSample, setIsPlayingSample] = useState(false);

  // Add global event listeners for mouseup/touchend to stop recording
  React.useEffect(() => {
    if (isRecording) {
      const handleStop = () => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
          try {
            mediaRecorderRef.current.stop();
          } catch (error) {
            console.error('Error stopping recording:', error);
          }
        }
        setIsRecording(false);
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => track.stop());
          streamRef.current = null;
        }
      };

      window.addEventListener('mouseup', handleStop);
      window.addEventListener('touchend', handleStop);
      window.addEventListener('touchcancel', handleStop);

      return () => {
        window.removeEventListener('mouseup', handleStop);
        window.removeEventListener('touchend', handleStop);
        window.removeEventListener('touchcancel', handleStop);
      };
    }
  }, [isRecording]);

  const startRecording = async () => {
    // Reset previous results when trying again
    if (feedback) {
      setFeedback(null);
      setRecordedBlob(null);
    }
    
    // Prevent starting if already recording
    if (isRecording) return;
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        setRecordedBlob(audioBlob);
        
        // Stop all tracks
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => track.stop());
          streamRef.current = null;
        }
        
        // Automatically evaluate after recording stops
        await evaluateRecording(audioBlob);
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (error) {
      alert('Không thể truy cập microphone. Vui lòng cho phép quyền truy cập.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      try {
        if (mediaRecorderRef.current.state === 'recording') {
          mediaRecorderRef.current.stop();
        }
        setIsRecording(false);
        // Note: evaluation will happen automatically in onstop handler
      } catch (error) {
        console.error('Error stopping recording:', error);
        setIsRecording(false);
        // Stop tracks even if stop() fails
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => track.stop());
          streamRef.current = null;
        }
      }
    }
  };

  const evaluateRecording = async (blob: Blob) => {
    setIsEvaluating(true);
    try {
      const result = await evaluatePronunciation(blob, question.targetPhrase || question.correctAnswer);
      setFeedback(result);
      // Mark as answered with the overall pronunciation score
      onSelect(`Score: ${result.pronunciationScore}`);
    } catch (error) {
      alert('Lỗi khi đánh giá phát âm. Vui lòng thử lại.');
    } finally {
      setIsEvaluating(false);
    }
  };

  const playSampleAudio = () => {
    if (isPlayingSample || !question.targetPhrase && !question.correctAnswer) return;

    // Use Web Speech API (built-in, free)
    const textToSpeak = question.targetPhrase || question.correctAnswer;
    
    // Cancel any ongoing speech
    window.speechSynthesis.cancel();
    
    const utterance = new SpeechSynthesisUtterance(textToSpeak);
    
    // Configure speech settings
    utterance.lang = 'en-US'; // English US accent
    utterance.rate = 0.85; // Slightly slower for learning (0.1 to 10)
    utterance.pitch = 1.0; // Normal pitch (0 to 2)
    utterance.volume = 1.0; // Full volume (0 to 1)
    
    // Event handlers
    utterance.onstart = () => setIsPlayingSample(true);
    utterance.onend = () => setIsPlayingSample(false);
    utterance.onerror = () => {
      setIsPlayingSample(false);
      alert("Không thể phát audio mẫu. Vui lòng kiểm tra trình duyệt có hỗ trợ Web Speech API.");
    };
    
    // Speak the text
    window.speechSynthesis.speak(utterance);
  };

  return (
    <div className="border-b border-slate-100 pb-6 last:border-0 last:pb-0">
      <div className="flex gap-3">
        <span className={`flex-shrink-0 w-8 h-8 rounded-full text-sm font-bold flex items-center justify-center mt-0.5 transition-colors ${
          feedback ? 'bg-antoree-lightGreen text-antoree-green' : 'bg-slate-100 text-slate-600'
        }`}>
          {feedback ? <CheckCircle2 className="w-5 h-5" /> : index + 1}
        </span>
        <div className="flex-grow">
          {/* Question Text */}
          <p className="font-medium text-slate-800 mb-3 text-lg leading-snug">{question.questionText}</p>

          {/* Target Phrase */}
          <div className="mb-6 p-5 bg-antoree-lightGreen rounded-xl border border-green-100">
            <div className="text-2xl font-bold text-antoree-green mb-2 text-center">
              "{question.targetPhrase || question.correctAnswer}"
            </div>
            {question.pronunciationTips && (
              <div className="text-sm text-antoree-darkGreen mt-3">
                <span className="font-semibold">💡 Tips: </span>
                {question.pronunciationTips}
              </div>
            )}
            
            {/* Sample Audio Button */}
            <div className="mt-4 flex justify-center">
              <button
                onClick={playSampleAudio}
                disabled={isPlayingSample}
                className={`px-6 py-3 rounded-full font-semibold transition-all shadow-sm ${
                  isPlayingSample 
                  ? 'bg-green-100 text-green-700 border border-green-200' 
                  : 'bg-antoree-green text-white hover:bg-antoree-darkGreen hover:shadow-md'
                }`}
              >
                {isPlayingSample ? 'Đang phát...' : 'Nghe Audio Mẫu'}
              </button>
            </div>
          </div>

          {/* Recording Controls */}
          <div className="flex flex-col items-center gap-4 mb-6">
            {!isRecording && !isEvaluating && (
              <button
                onMouseDown={startRecording}
                onMouseUp={stopRecording}
                onMouseLeave={stopRecording}
                onTouchStart={(e) => {
                  e.preventDefault();
                  startRecording();
                }}
                onTouchEnd={(e) => {
                  e.preventDefault();
                  stopRecording();
                }}
                disabled={isSubmitted}
                className="px-8 py-4 bg-red-500 text-white font-bold rounded-full hover:bg-red-600 shadow-lg transition-all hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-3 active:scale-95"
              >
                <Mic2 className="w-5 h-5" />
                {feedback ? 'Nhấn giữ để nói lại' : 'Nhấn giữ để nói'}
              </button>
            )}

            {isRecording && (
              <button
                onMouseUp={stopRecording}
                onTouchEnd={(e) => {
                  e.preventDefault();
                  stopRecording();
                }}
                className="px-8 py-4 bg-red-600 text-white font-bold rounded-full shadow-lg animate-pulse flex items-center gap-3 cursor-pointer active:scale-95"
              >
                <Mic2 className="w-5 h-5 animate-pulse" />
                Đang ghi âm... (Thả để nộp)
              </button>
            )}

            {isEvaluating && (
              <div className="flex items-center gap-2 text-antoree-green font-medium">
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-antoree-green"></div>
                Đang đánh giá phát âm...
              </div>
            )}
          </div>

          {/* Pronunciation Feedback - Duolingo Style */}
          {feedback && (
            <div className="mt-4 space-y-4">
              {/* Accuracy Percentage */}
              <div className="bg-gradient-to-r from-antoree-green to-green-600 rounded-xl p-6 text-white shadow-lg">
                <div className="text-center">
                  <div className="text-5xl font-bold mb-2">{Math.round(feedback.pronunciationScore)}%</div>
                  <div className="text-lg opacity-90">Độ chính xác phát âm</div>
                </div>
              </div>

              {/* Word-by-Word Feedback - Duolingo Style */}
              {feedback.wordFeedback && feedback.wordFeedback.length > 0 && (
                <div className="bg-white rounded-xl border border-slate-200 p-6">
                  <div className="text-center mb-4">
                    <p className="text-sm font-semibold text-slate-600 mb-2">Bạn đã nói:</p>
                    <div className="text-2xl font-bold leading-relaxed">
                      {feedback.wordFeedback.map((word, idx) => {
                        let colorClass = '';
                        if (word.status === 'correct') {
                          colorClass = 'text-green-600';
                        } else if (word.status === 'partial') {
                          colorClass = 'text-yellow-600';
                        } else {
                          colorClass = 'text-red-600';
                        }
                        
                        return (
                          <span key={idx} className={colorClass}>
                            {word.word}
                            {idx < feedback.wordFeedback.length - 1 && ' '}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* Playback */}
              {recordedBlob && (
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                  <div className="font-bold text-slate-700 mb-2">
                    Nghe lại bản ghi của bạn:
                  </div>
                  <audio controls className="w-full" src={URL.createObjectURL(recordedBlob)} />
                </div>
              )}
            </div>
          )}

          {/* Show correct phrase when teacher views answers */}
          {showAnswer && !feedback && (
            <div className="mt-4 p-4 rounded-xl text-sm bg-blue-50 text-blue-800 border border-blue-100">
              <span className="font-bold block mb-1">Target Phrase:</span>
              {question.targetPhrase || question.correctAnswer}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ExerciseCard;