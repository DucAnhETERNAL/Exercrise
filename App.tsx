import React, { useState, useEffect } from 'react';
import { CefrLevel, ExerciseType, GeneratedContent, UserPreferences } from './types';
import InputForm from './components/InputForm';
import ExerciseCard from './components/ExerciseCard';
import { generateExercises } from './services/geminiService';
import { uploadToDrive, loadFromDrive, initDriveApi } from './services/driveService';
import { Sparkles, Printer, RefreshCw, Eye, EyeOff, CheckCircle, Trophy, Link as LinkIcon, Copy, Share2, User, Cloud, Loader2, AlertTriangle } from 'lucide-react';

const App: React.FC = () => {
  // --- Modes ---
  const [isStudentMode, setIsStudentMode] = useState(false);
  
  // --- State ---
  const [preferences, setPreferences] = useState<UserPreferences>({
    topic: '',
    vocabulary: '',
    grammarFocus: '',
    level: CefrLevel.B1,
    selectedTypes: [ExerciseType.GRAMMAR, ExerciseType.READING],
    questionCount: 5
  });

  const [content, setContent] = useState<GeneratedContent | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [showAnswers, setShowAnswers] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shareLink, setShareLink] = useState<string | null>(null);

  // Scoring
  const [userAnswers, setUserAnswers] = useState<Record<string, string>>({});
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [scoreData, setScoreData] = useState<{ correct: number; total: number } | null>(null);
  const [copiedResult, setCopiedResult] = useState(false);

  // Initialize Drive API on mount
  useEffect(() => {
    initDriveApi().catch(console.error);
  }, []);

  // --- Initialization: Check for Shared Link (File ID) ---
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fileId = params.get('fileId');

    if (fileId) {
      setIsStudentMode(true);
      setIsLoading(true);
      loadFromDrive(fileId)
        .then((data) => {
          setContent(data as GeneratedContent);
          // Clean URL
          window.history.replaceState({}, document.title, window.location.pathname);
        })
        .catch((err) => {
          setError("Không thể tải bài tập từ Google Drive. Link có thể bị hỏng hoặc file đã bị xóa.");
          console.error(err);
        })
        .finally(() => {
          setIsLoading(false);
        });
    }
  }, []);

  // --- Handlers ---

  const handleGenerate = async () => {
    setIsLoading(true);
    setError(null);
    setContent(null); 
    setShowAnswers(false);
    setShareLink(null);
    
    // Reset scoring state
    setUserAnswers({});
    setIsSubmitted(false);
    setScoreData(null);

    try {
      const result = await generateExercises(preferences);
      setContent(result);
    } catch (err) {
      setError("Failed to generate exercises. Please check your connection or API key limit and try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveToDrive = async () => {
    if (!content) return;
    
    setIsUploading(true);
    try {
      const fileName = `GenEnglish_${preferences.level}_${preferences.topic || 'Exercise'}_${Date.now()}.json`;
      
      // Upload full content (including images) to Drive
      const fileId = await uploadToDrive(content, fileName);
      
      const baseUrl = window.location.href.split('?')[0];
      const url = `${baseUrl}?fileId=${fileId}`;
      setShareLink(url);
    } catch (e: any) {
      console.error(e);
      if (e.error === 'popup_blocked_by_browser') {
        alert("Trình duyệt đã chặn cửa sổ đăng nhập Google. Vui lòng cho phép popup và thử lại.");
      } else {
        alert("Lỗi khi lưu vào Drive: " + (e.message || JSON.stringify(e)));
      }
    } finally {
      setIsUploading(false);
    }
  };

  const handleCopyLink = () => {
    if (shareLink) {
      navigator.clipboard.writeText(shareLink);
      alert("Đã sao chép link! Hãy gửi cho học viên.");
    }
  };

  const handleAnswerSelect = (sectionIndex: number, questionIndex: number, option: string) => {
    if (isSubmitted) return; 
    const key = `${sectionIndex}-${questionIndex}`;
    setUserAnswers(prev => ({ ...prev, [key]: option }));
  };

  const handleSubmit = () => {
    if (!content) return;

    let correctCount = 0;
    let totalCount = 0;

    content.sections.forEach((section, sIdx) => {
      section.questions.forEach((q, qIdx) => {
        totalCount++;
        const key = `${sIdx}-${qIdx}`;
        if (userAnswers[key] === q.correctAnswer) {
          correctCount++;
        }
      });
    });

    setScoreData({ correct: correctCount, total: totalCount });
    setIsSubmitted(true);
    // Students see answers after submitting
    setShowAnswers(true); 
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const generateReportCard = () => {
    if (!scoreData || !content) return "";
    
    const percentage = Math.round((scoreData.correct / scoreData.total) * 100);
    const date = new Date().toLocaleDateString();
    
    let report = `📝 GENENGLISH RESULT REPORT\n`;
    report += `Date: ${date}\n`;
    report += `Score: ${scoreData.correct}/${scoreData.total} (${percentage}%)\n`;
    report += `----------------------------\n`;
    
    content.sections.forEach((section, sIdx) => {
      report += `\nSection: ${section.title} (${section.type})\n`;
      section.questions.forEach((q, qIdx) => {
        const key = `${sIdx}-${qIdx}`;
        const userChoice = userAnswers[key] || "No Answer";
        const isCorrect = userChoice === q.correctAnswer;
        report += `${qIdx + 1}. ${isCorrect ? "✅" : "❌"} (Ans: ${userChoice})\n`;
      });
    });
    
    return report;
  };

  const handleCopyResult = () => {
    const report = generateReportCard();
    navigator.clipboard.writeText(report);
    setCopiedResult(true);
    setTimeout(() => setCopiedResult(false), 3000);
  };

  const handleResetToTeacherMode = () => {
    if (confirm("Thoát chế độ Học viên và quay lại trang Giáo viên?")) {
      window.location.href = window.location.pathname; // Clear params
    }
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="min-h-screen bg-slate-50 pb-20 font-inter">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-sm print:hidden">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => isStudentMode && handleResetToTeacherMode()}>
            <div className="bg-indigo-600 p-1.5 rounded-lg">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 to-violet-600">
              GenEnglish
            </h1>
          </div>
          <div className="flex items-center gap-3">
            {isStudentMode && (
              <span className="bg-indigo-100 text-indigo-800 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide flex items-center gap-1">
                <User className="w-3 h-3" /> Student View
              </span>
            )}
            <div className="text-sm text-slate-500 font-medium hidden sm:block">
              AI-Powered Learning
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* SIDEBAR: Hidden in Student Mode usually, but let's keep Actions visible */}
          {!isStudentMode && (
            <div className="lg:col-span-4 space-y-6 print:hidden">
              <InputForm 
                preferences={preferences} 
                onChange={setPreferences} 
                onSubmit={handleGenerate}
                isLoading={isLoading}
              />
            </div>
          )}

          {/* MAIN CONTENT AREA */}
          <div className={`${isStudentMode ? 'lg:col-span-8 lg:col-start-3' : 'lg:col-span-8'}`}>
            
            {/* Error State */}
            {error && (
              <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-r mb-6">
                <p className="text-red-700 font-medium">Lỗi</p>
                <p className="text-red-600 text-sm">{error}</p>
                {isStudentMode && (
                  <button onClick={handleResetToTeacherMode} className="text-red-700 underline text-sm mt-2">
                    Quay về trang chủ
                  </button>
                )}
              </div>
            )}

            {/* Empty State (Teacher Mode) */}
            {!content && !isLoading && !error && !isStudentMode && (
              <div className="text-center py-20 bg-white rounded-3xl border border-dashed border-slate-200">
                <div className="w-16 h-16 bg-indigo-50 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Sparkles className="w-8 h-8 text-indigo-400" />
                </div>
                <h2 className="text-xl font-semibold text-slate-800 mb-2">Teacher Dashboard</h2>
                <p className="text-slate-500 max-w-md mx-auto">
                  Cấu hình ở menu bên trái để tạo đề. Sau khi tạo xong, bạn có thể lưu vào Google Drive và chia sẻ link ngắn gọn.
                </p>
              </div>
            )}

            {/* Loading Skeleton */}
            {isLoading && !content && (
               <div className="space-y-6 animate-pulse">
                  <div className="flex items-center justify-center h-64">
                    <div className="text-center">
                        <Loader2 className="w-10 h-10 text-indigo-600 animate-spin mx-auto mb-4" />
                        <p className="text-slate-500 font-medium">Đang tải dữ liệu{isStudentMode ? ' từ Google Drive...' : '...'}</p>
                    </div>
                  </div>
               </div>
            )}

            {/* Score Banner (Visible after submit) */}
            {isSubmitted && scoreData && (
              <div className="bg-gradient-to-r from-indigo-500 to-purple-600 rounded-2xl p-6 text-white shadow-lg mb-8 animate-fade-in relative overflow-hidden">
                <div className="flex items-center justify-between relative z-10">
                  <div>
                    <h2 className="text-2xl font-bold flex items-center gap-2">
                      <Trophy className="w-6 h-6 text-yellow-300" />
                      Điểm số: {scoreData.correct} / {scoreData.total}
                    </h2>
                    <p className="text-indigo-100 mt-1">
                      {scoreData.correct === scoreData.total ? "Tuyệt vời! Điểm tuyệt đối." : "Làm tốt lắm! Hãy xem lại đáp án bên dưới."}
                    </p>
                  </div>
                  <div className="text-right">
                    <button 
                      onClick={handleCopyResult}
                      className="flex items-center gap-2 bg-white text-indigo-600 px-4 py-2 rounded-lg font-bold shadow-md hover:bg-indigo-50 transition-colors"
                    >
                      {copiedResult ? <CheckCircle className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                      {copiedResult ? "Copied!" : "Copy Result"}
                    </button>
                    <p className="text-xs text-indigo-200 mt-2 text-center">Gửi kết quả này cho giáo viên</p>
                  </div>
                </div>
                {/* Decoration */}
                <div className="absolute -bottom-10 -right-10 text-9xl font-black text-white opacity-10 rotate-12 pointer-events-none">
                  {Math.round((scoreData.correct / scoreData.total) * 100)}%
                </div>
              </div>
            )}

            {/* ACTION BAR (Top of content) */}
            {content && (
              <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 mb-6 flex flex-wrap items-center justify-between gap-4 print:hidden">
                <div className="flex gap-2">
                  {!isSubmitted && (
                    <button 
                      onClick={handleSubmit}
                      className="flex items-center gap-2 px-5 py-2.5 bg-green-600 text-white font-bold rounded-lg hover:bg-green-700 shadow-md transition-all hover:-translate-y-0.5"
                    >
                      <CheckCircle className="w-5 h-5" />
                      Nộp bài
                    </button>
                  )}
                  {isSubmitted && isStudentMode && (
                     <span className="flex items-center gap-2 px-4 py-2 bg-green-50 text-green-700 font-medium rounded-lg border border-green-200">
                        <CheckCircle className="w-4 h-4" /> Đã hoàn thành
                     </span>
                  )}
                </div>

                <div className="flex gap-2 w-full sm:w-auto justify-end">
                  {/* Teacher Only Actions */}
                  {!isStudentMode && (
                    <>
                      <button 
                         onClick={handleSaveToDrive}
                         disabled={isUploading}
                         className="flex items-center gap-2 px-3 py-2 bg-indigo-50 text-indigo-700 font-medium rounded-lg hover:bg-indigo-100 transition-colors border border-indigo-200"
                      >
                        {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Cloud className="w-4 h-4" />}
                        {isUploading ? 'Đang lưu...' : 'Lưu & Share (Drive)'}
                      </button>
                      <button 
                        onClick={() => setShowAnswers(!showAnswers)}
                        className="flex items-center gap-2 px-3 py-2 border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-50 transition-colors"
                      >
                        {showAnswers ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        <span className="hidden sm:inline">{showAnswers ? 'Ẩn đáp án' : 'Hiện đáp án'}</span>
                      </button>
                      <button 
                        onClick={handleGenerate}
                        disabled={isLoading}
                        className="flex items-center gap-2 px-3 py-2 border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-50 transition-colors"
                      >
                        <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                      </button>
                    </>
                  )}
                  
                  {/* Common Actions */}
                  <button 
                    onClick={handlePrint}
                    className="flex items-center gap-2 px-3 py-2 border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-50 transition-colors"
                    title="Print"
                  >
                    <Printer className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

            {/* Share Link Modal/Area */}
            {shareLink && !isStudentMode && (
              <div className="mb-6 bg-green-50 border border-green-200 p-4 rounded-xl animate-fade-in">
                <div className="flex items-center gap-2 mb-2 text-green-800 font-semibold">
                   <Share2 className="w-4 h-4" /> Link bài tập (Đã lưu trên Drive)
                </div>
                <div className="flex gap-2">
                   <input 
                      type="text" 
                      readOnly 
                      value={shareLink} 
                      className="w-full bg-white border border-green-200 rounded-lg px-3 py-2 text-sm text-slate-600 focus:outline-none"
                   />
                   <button 
                      onClick={handleCopyLink}
                      className="bg-green-100 hover:bg-green-200 text-green-800 px-4 py-2 rounded-lg font-medium text-sm transition-colors whitespace-nowrap"
                   >
                     Copy Link
                   </button>
                </div>
                <div className="flex gap-2 mt-3 items-start">
                  <Cloud className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-green-700">
                    File đã được lưu vào Google Drive của bạn và được set quyền công khai. Học viên có thể truy cập link này để làm bài (bao gồm đầy đủ hình ảnh).
                  </p>
                </div>
              </div>
            )}

            {/* Content Render */}
            {content && (
              <div className="space-y-8 print:space-y-4">
                <div className="text-center mb-8 border-b border-slate-200 pb-6">
                  <h1 className="text-3xl font-bold text-slate-900 mb-2">
                    {isStudentMode ? 'Student Assessment' : 'English Worksheet'}
                  </h1>
                  <p className="text-slate-500 flex items-center justify-center gap-2">
                    <span className="bg-slate-100 px-2 py-0.5 rounded text-xs font-mono font-bold">LEVEL {preferences.level}</span>
                    <span className="text-slate-300">|</span>
                    <span>{preferences.topic || content.sections[0]?.title}</span>
                  </p>
                </div>

                {content.sections.map((section, sIdx) => (
                  <ExerciseCard 
                    key={`${section.id}-${sIdx}`} 
                    section={section} 
                    sectionIndex={sIdx}
                    userAnswers={userAnswers}
                    onAnswerSelect={handleAnswerSelect}
                    isSubmitted={isSubmitted}
                    showAnswersGlobal={showAnswers} 
                  />
                ))}
              </div>
            )}
            
            {isStudentMode && (
               <div className="text-center mt-12 mb-8">
                  <p className="text-slate-400 text-sm mb-4">Hoàn thành bài kiểm tra?</p>
                  <button onClick={handleResetToTeacherMode} className="text-indigo-600 font-medium hover:underline text-sm">
                     Tạo bài tập mới bằng AI (Dành cho Giáo viên)
                  </button>
               </div>
            )}

          </div>
        </div>
      </main>
    </div>
  );
};

export default App;