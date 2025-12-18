import React, { useState, useEffect } from 'react';
import { CefrLevel, ExerciseType, GeneratedContent, UserPreferences, StudentSubmission, GoogleFormConfig, LoadingStatus } from './types';
import InputForm from './components/InputForm';
import ExerciseCard from './components/ExerciseCard';
import { generateExercises } from './services/geminiService';
import { uploadToDrive, loadFromDrive, initDriveApi } from './services/driveService';
import { submitToGoogleForm } from './services/formService';
import { Sparkles, Printer, RefreshCw, Eye, EyeOff, CheckCircle, Trophy, Copy, Share2, User, Cloud, Loader2, Save, FileCheck, MessageSquare, X, ExternalLink } from 'lucide-react';

const App: React.FC = () => {
  // --- Modes ---
  const [isStudentMode, setIsStudentMode] = useState(false);
  const [isReviewMode, setIsReviewMode] = useState(false);
  
  // --- State ---
  const [preferences, setPreferences] = useState<UserPreferences>({
    topic: '',
    vocabulary: '',
    grammarFocus: '',
    selectedTypes: [ExerciseType.GRAMMAR, ExerciseType.READING],
    questionCount: 5
  });

  const [content, setContent] = useState<GeneratedContent | null>(null);
  const [currentFileId, setCurrentFileId] = useState<string | null>(null); // Track the current exercise ID
  
  const [loadingStatus, setLoadingStatus] = useState<LoadingStatus>('idle');
  // const [isUploading, setIsUploading] = useState(false); // Replaced by loadingStatus='uploading'
  const [showAnswers, setShowAnswers] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shareLink, setShareLink] = useState<string | null>(null);
  
  // Scoring & Student Data
  const [studentName, setStudentName] = useState("");
  const [studentFeedback, setStudentFeedback] = useState("");
  const [userAnswers, setUserAnswers] = useState<Record<string, string>>({});
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [scoreData, setScoreData] = useState<{ correct: number; total: number } | null>(null);
  const [formSubmitted, setFormSubmitted] = useState(false);
  const [feedbackTimerId, setFeedbackTimerId] = useState<number | null>(null);
  
  // Google Form Config - Hardcoded for test version
  const formConfig: GoogleFormConfig = {
    formUrl: 'https://docs.google.com/forms/d/e/1FAIpQLSe0cKheNhIxDlwctfSqxyZUmkofxq7K0bPEHm_ct20yFGoadw/formResponse',
    nameEntryId: 'entry.307258376',
    scoreEntryId: 'entry.1105820957',
    feedbackEntryId: 'entry.1196321293'
  };

  // Modal State for Student Submission
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmModalData, setConfirmModalData] = useState<{ answered: number; total: number } | null>(null);

  // Initialize Drive API on mount
  useEffect(() => {
    initDriveApi().catch(() => {});
  }, []);

  // --- Initialization: Check for Shared Link (File ID) ---
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fileId = params.get('fileId');
    
    // Form config is hardcoded in test version, no need to load from URL

    if (fileId) {
      // CASE 2: STUDENT TAKING EXERCISE
      handleLoadExercise(fileId);
    }
  }, []);

  const handleLoadExercise = (fileId: string) => {
    setIsStudentMode(true);
    setCurrentFileId(fileId);
    setLoadingStatus('loading_drive');
    
    loadFromDrive(fileId)
      .then((data) => {
        setContent(data as GeneratedContent);
        // Clean URL visual only
        window.history.replaceState({}, document.title, window.location.pathname);
      })
      .catch(() => {
        setError("Không thể tải bài tập từ Google Drive. Link có thể bị hỏng hoặc file đã bị xóa.");
      })
      .finally(() => {
        setLoadingStatus('idle');
      });
  }

  // --- Handlers ---

  const handleGenerate = async () => {
    setLoadingStatus('generating_content');
    setError(null);
    setContent(null); 
    setShowAnswers(false);
    setShareLink(null);
    setCurrentFileId(null);
    
    // Reset scoring state
    setUserAnswers({});
    setIsSubmitted(false);
    setScoreData(null);
    setStudentName("");
    setStudentFeedback("");
    setFormSubmitted(false);

    try {
      const result = await generateExercises(preferences, (status) => setLoadingStatus(status));
      setContent(result);
    } catch (err) {
      setError("Failed to generate exercises. Please check your connection or API key limit and try again.");
    } finally {
      setLoadingStatus('idle');
    }
  };

  // Teacher saves Exercise Template + Generates Link with Form Config
  const handleSaveExerciseToDrive = async () => {
    if (!content) return;

    setLoadingStatus('uploading');
    try {
      const fileName = `GenEnglish_${preferences.topic || 'Exercise'}_${Date.now()}.json`;
      
      const fileId = await uploadToDrive(content, fileName);
      setCurrentFileId(fileId); 
      
      const baseUrl = window.location.href.split('?')[0];
      // Form config is hardcoded, no need to encode in URL
      const url = `${baseUrl}?fileId=${fileId}`;
      setShareLink(url);
    } catch (e: any) {
      if (e.error === 'popup_blocked_by_browser') {
        alert("Trình duyệt đã chặn cửa sổ đăng nhập Google. Vui lòng cho phép popup và thử lại.");
      } else {
        alert("Lỗi khi lưu vào Drive: " + (e.message || JSON.stringify(e)));
      }
    } finally {
      setLoadingStatus('idle');
    }
  };

  // Student submits to Google Form
  const handleSubmitToForm = async () => {
    if (!scoreData || !studentName.trim()) {
      alert("Vui lòng nhập tên của bạn.");
      return;
    }
    
    // Clear feedback timer if exists
    if (feedbackTimerId) {
      clearTimeout(feedbackTimerId);
      setFeedbackTimerId(null);
    }
    
    setLoadingStatus('uploading');
    try {
      const submissionData: StudentSubmission = {
        type: 'submission',
        studentName: studentName.trim(),
        originalFileId: currentFileId,
        score: scoreData,
        feedback: studentFeedback, 
        timestamp: Date.now()
      };

      await submitToGoogleForm(submissionData, formConfig);
      
      setFormSubmitted(true);
      setShowSaveModal(false); 
      alert("Nộp bài thành công! Giáo viên đã nhận được kết quả.");
    } catch (e: any) {
      alert("Lỗi khi nộp bài: " + (e.message || "Unknown error"));
    } finally {
      setLoadingStatus('idle');
    }
  };

  const [linkCopied, setLinkCopied] = useState(false);

  const handleCopyLink = (link: string) => {
    if (link) {
      navigator.clipboard.writeText(link);
      // Show subtle notification instead of alert
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    }
  };

  const handleAnswerSelect = (sectionIndex: number, questionIndex: number, option: string) => {
    if (isSubmitted) return; 
    const key = `${sectionIndex}-${questionIndex}`;
    setUserAnswers(prev => ({ ...prev, [key]: option }));
  };

  const handleSubmit = () => {
    if (!content) return;

    // Count answered questions
    let answeredCount = 0;
    let totalCount = 0;

    content.sections.forEach((section, sIdx) => {
      section.questions.forEach((q, qIdx) => {
        totalCount++;
        const key = `${sIdx}-${qIdx}`;
        if (userAnswers[key]) {
          answeredCount++;
        }
      });
    });

    // Show confirmation modal for students
    if (isStudentMode) {
      setConfirmModalData({ answered: answeredCount, total: totalCount });
      setShowConfirmModal(true);
      return;
    }

    // For non-student mode, submit directly
    confirmSubmit();
  };

  const confirmSubmit = () => {
    if (!content) return;

    // Calculate score
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
    
    // Close confirm modal
    setShowConfirmModal(false);
    
    // Show feedback modal immediately for students
    if (isStudentMode) {
      setShowSaveModal(true);
    }
    
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleResetToTeacherMode = () => {
    if (confirm("Thoát chế độ hiện tại và quay lại trang Giáo viên?")) {
      window.location.href = window.location.pathname; // Clear params
    }
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className={`min-h-screen bg-slate-50 font-inter ${isStudentMode ? 'pb-32' : 'pb-20'}`}>
      {/* Header */}
      <header className={`border-b border-slate-200 sticky top-0 z-30 shadow-sm print:hidden transition-colors ${isReviewMode ? 'bg-amber-50' : 'bg-white'}`}>
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => (isStudentMode || isReviewMode) && handleResetToTeacherMode()}>
            <div className="bg-indigo-600 p-1.5 rounded-lg">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 to-violet-600">
              GenEnglish
            </h1>
          </div>
          <div className="flex items-center gap-3">
            {isStudentMode && !isReviewMode && (
              <span className="bg-indigo-100 text-indigo-800 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide flex items-center gap-1">
                <User className="w-3 h-3" /> Student View
              </span>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* SIDEBAR: Hidden in Student/Review Mode */}
          {!isStudentMode && !isReviewMode && (
            <div className="lg:col-span-4 space-y-6 print:hidden">
              <InputForm 
                preferences={preferences} 
                onChange={setPreferences} 
                onSubmit={handleGenerate}
                loadingStatus={loadingStatus}
                onVideoAnalysisStatusChange={setLoadingStatus}
              />
            </div>
          )}

          {/* MAIN CONTENT AREA */}
          <div className={`${(isStudentMode || isReviewMode) ? 'lg:col-span-8 lg:col-start-3' : 'lg:col-span-8'}`}>
            
            {/* Error State */}
            {error && (
              <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-r mb-6">
                <p className="text-red-700 font-medium">Lỗi</p>
                <p className="text-red-600 text-sm">{error}</p>
                <button onClick={handleResetToTeacherMode} className="text-red-700 underline text-sm mt-2">
                  Quay về trang chủ
                </button>
              </div>
            )}

            {/* Empty State (Teacher Mode) */}
            {!content && loadingStatus === 'idle' && !error && !isStudentMode && !isReviewMode && (
              <div className="text-center py-20 bg-white rounded-3xl border border-dashed border-slate-200">
                <div className="w-16 h-16 bg-indigo-50 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Sparkles className="w-8 h-8 text-indigo-400" />
                </div>
                <h2 className="text-xl font-semibold text-slate-800 mb-2">Teacher Dashboard</h2>
                <p className="text-slate-500 max-w-md mx-auto mb-6">
                  Cấu hình ở menu bên trái để tạo đề.
                </p>
              </div>
            )}

            {/* Loading Skeleton */}
            {loadingStatus !== 'idle' && !content && (
               <div className="space-y-6 animate-pulse">
                  <div className="flex items-center justify-center h-64">
                    <div className="text-center">
                        <Loader2 className="w-10 h-10 text-indigo-600 animate-spin mx-auto mb-4" />
                        <p className="text-slate-500 font-medium animate-pulse">
                          {loadingStatus === 'analyzing_video' && 'Đang phân tích video...'}
                          {loadingStatus === 'generating_content' && 'Đang tạo nội dung bài tập...'}
                          {loadingStatus === 'generating_images' && 'Đang vẽ hình minh họa (sẽ mất chút thời gian)...'}
                          {loadingStatus === 'loading_drive' && 'Đang tải dữ liệu từ Drive...'}
                          {loadingStatus === 'uploading' && 'Đang xử lý...'}
                          {!['analyzing_video', 'generating_content', 'generating_images', 'loading_drive', 'uploading'].includes(loadingStatus) && 'Đang xử lý...'}
                        </p>
                        {loadingStatus === 'generating_images' && (
                             <p className="text-xs text-slate-400 mt-2">AI đang tạo hình ảnh cho các câu hỏi...</p>
                        )}
                    </div>
                  </div>
               </div>
            )}

            {/* Score Banner */}
            {isSubmitted && scoreData && (
              <div className="bg-gradient-to-r from-indigo-500 to-purple-600 rounded-2xl p-6 text-white shadow-lg mb-8 animate-fade-in relative overflow-hidden">
                <div className="flex flex-col md:flex-row items-center justify-between relative z-10 gap-4">
                  <div className="flex-1">
                    <h2 className="text-2xl font-bold flex items-center gap-2">
                      <Trophy className="w-6 h-6 text-yellow-300" />
                      {isReviewMode && studentName ? studentName : "Kết quả của bạn"}: {scoreData.correct} / {scoreData.total}
                    </h2>
                    
                    {!isReviewMode && (
                         <p className="text-indigo-100 mt-1">
                          {scoreData.correct === scoreData.total ? "Tuyệt vời! Điểm tuyệt đối." : "Đã hoàn thành bài kiểm tra."}
                        </p>
                    )}
                  </div>
                  
                  {/* Student Save Actions: Open Modal */}
                  {isStudentMode && !isReviewMode && !formSubmitted && (
                    <button 
                         onClick={() => setShowSaveModal(true)}
                         className="bg-white text-indigo-700 px-6 py-3 rounded-xl font-bold text-sm hover:bg-indigo-50 transition-all shadow-md flex items-center gap-2 whitespace-nowrap hover:scale-105 active:scale-95"
                    >
                        <Save className="w-4 h-4" />
                        Nộp Kết Quả
                    </button>
                  )}
                  {formSubmitted && (
                     <div className="bg-white/20 px-4 py-2 rounded-lg flex items-center gap-2 font-bold text-sm">
                        <CheckCircle className="w-5 h-5" /> Đã nộp thành công
                     </div>
                  )}
                </div>
                <div className="absolute -bottom-10 -right-10 text-9xl font-black text-white opacity-10 rotate-12 pointer-events-none">
                  {Math.round((scoreData.correct / scoreData.total) * 100)}%
                </div>
              </div>
            )}

            {/* CONFIRMATION MODAL - Before Submit */}
            {showConfirmModal && confirmModalData && (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
                <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-slide-up">
                  <div className={`px-6 py-4 flex items-center justify-between ${
                    confirmModalData.answered < confirmModalData.total 
                    ? 'bg-amber-500' 
                    : 'bg-green-600'
                  }`}>
                    <h3 className="text-white font-bold text-lg flex items-center gap-2">
                      {confirmModalData.answered < confirmModalData.total ? (
                        <>⚠️ Kiểm tra lại bài làm</>
                      ) : (
                        <>Bạn có chắc chắn muốn nộp bài không?</>
                      )}
                    </h3>
                    <button 
                      onClick={() => setShowConfirmModal(false)} 
                      className="text-white/80 hover:text-white transition-colors"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                  
                  <div className="p-6 space-y-4">
                    {/* Progress Stats */}
                    <div className="bg-slate-50 rounded-xl p-4 border-2 border-slate-200">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-slate-600 font-medium">Số câu đã làm:</span>
                        <span className="text-2xl font-bold text-slate-900">
                          {confirmModalData.answered} / {confirmModalData.total}
                        </span>
                      </div>
                      
                      {/* Progress Bar */}
                      <div className="w-full bg-slate-200 rounded-full h-3 overflow-hidden">
                        <div 
                          className={`h-full rounded-full transition-all duration-500 ${
                            confirmModalData.answered < confirmModalData.total 
                            ? 'bg-amber-500' 
                            : 'bg-green-600'
                          }`}
                          style={{ width: `${(confirmModalData.answered / confirmModalData.total) * 100}%` }}
                        ></div>
                      </div>
                      
                      {confirmModalData.answered < confirmModalData.total && (
                        <p className="text-amber-600 text-sm font-medium mt-3 flex items-center gap-1">
                          <span>⚠️</span>
                          Còn {confirmModalData.total - confirmModalData.answered} câu chưa trả lời
                        </p>
                      )}
                    </div>

                    {/* Message */}
                    <div className={`p-4 rounded-xl ${
                      confirmModalData.answered < confirmModalData.total 
                      ? 'bg-amber-50 border border-amber-200' 
                      : 'bg-green-50 border border-green-200'
                    }`}>
                      <p className={`text-sm ${
                        confirmModalData.answered < confirmModalData.total 
                        ? 'text-amber-900' 
                        : 'text-green-900'
                      }`}>
                        {confirmModalData.answered < confirmModalData.total ? (
                          <>
                            <strong>Lưu ý:</strong> Bạn vẫn có thể nộp bài ngay, nhưng các câu chưa làm sẽ được tính là sai. 
                            Hãy kiểm tra lại trước khi nộp nhé!
                          </>
                        ) : (
                          <>
                            <strong>Tuyệt vời!</strong> Bạn đã hoàn thành tất cả các câu hỏi. 
                            Bấm "Nộp Bài" để xem kết quả!
                          </>
                        )}
                      </p>
                    </div>
                  </div>

                  <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-3">
                    <button 
                      onClick={() => setShowConfirmModal(false)}
                      className="px-6 py-3 text-slate-700 font-semibold hover:bg-slate-200 rounded-xl transition-all"
                    >
                      {confirmModalData.answered < confirmModalData.total ? 'Làm tiếp' : 'Hủy'}
                    </button>
                    <button 
                      onClick={confirmSubmit}
                      className={`px-6 py-3 text-white font-bold rounded-xl shadow-lg transition-all hover:scale-105 active:scale-95 flex items-center gap-2 ${
                        confirmModalData.answered < confirmModalData.total 
                        ? 'bg-amber-600 hover:bg-amber-700' 
                        : 'bg-green-600 hover:bg-green-700'
                      }`}
                    >
                      <CheckCircle className="w-5 h-5" />
                      Nộp Bài
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* STUDENT SUBMIT MODAL */}
            {showSaveModal && (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
                <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-slide-up">
                  <div className="bg-indigo-600 px-6 py-4 flex items-center justify-between">
                    <h3 className="text-white font-bold text-lg flex items-center gap-2">
                      <Cloud className="w-5 h-5" /> Nộp Bài Cho Giáo Viên
                    </h3>
                    <button onClick={() => setShowSaveModal(false)} className="text-indigo-200 hover:text-white transition-colors">
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                  
                  <div className="p-6 space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Họ và tên của bạn <span className="text-red-500">*</span></label>
                      <input 
                        type="text"
                        value={studentName}
                        onChange={(e) => setStudentName(e.target.value)}
                        placeholder="Nguyễn Văn A"
                        autoFocus
                        className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
                      />
                    </div>
                    
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Feedback / Cảm nhận của bạn</label>
                      <textarea 
                        rows={3}
                        value={studentFeedback}
                        onChange={(e) => {
                          setStudentFeedback(e.target.value);
                          
                          // Clear existing timer
                          if (feedbackTimerId) {
                            clearTimeout(feedbackTimerId);
                          }
                          
                          // Start 5s auto-submit timer when student starts typing feedback
                          if (e.target.value.trim().length > 0) {
                            const timerId = window.setTimeout(() => {
                              if (studentName.trim()) {
                                handleSubmitToForm();
                              }
                            }, 10000);
                            setFeedbackTimerId(timerId);
                          }
                        }}
                        placeholder="Bài tập này thế nào?"
                        className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all resize-none"
                      />
                      {feedbackTimerId && studentFeedback.trim().length > 0 && (
                        <p className="text-xs text-slate-500 mt-1">Sẽ tự động nộp sau 5 giây...</p>
                      )}
                    </div>

                    <div className="bg-indigo-50 p-3 rounded-lg flex items-center justify-between text-indigo-900 font-medium">
                      <span>Điểm của bạn:</span>
                      <span className="text-lg font-bold">{scoreData?.correct} / {scoreData?.total}</span>
                    </div>
                  </div>

                  <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-3">
                    <button 
                      onClick={() => setShowSaveModal(false)}
                      className="px-4 py-2 text-slate-600 font-medium hover:bg-slate-200 rounded-lg transition-colors"
                    >
                      Hủy
                    </button>
                    <button 
                      onClick={handleSubmitToForm}
                      disabled={loadingStatus === 'uploading' || !studentName.trim()}
                      className={`px-4 py-2 bg-indigo-600 text-white font-bold rounded-lg shadow hover:bg-indigo-700 transition-all flex items-center gap-2 ${loadingStatus === 'uploading' || !studentName.trim() ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      {loadingStatus === 'uploading' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                      {loadingStatus === 'uploading' ? 'Đang gửi...' : 'Nộp Bài'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ACTION BAR (Top of content) */}
            {content && (
              <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 mb-6 flex flex-wrap items-center justify-between gap-4 print:hidden">
                <div className="flex gap-2">
                  {/* Hide submit button in student mode (use sticky bar instead) */}
                  {!isSubmitted && !isStudentMode && (
                    <button 
                      onClick={handleSubmit}
                      className="flex items-center gap-2 px-5 py-2.5 bg-green-600 text-white font-bold rounded-lg hover:bg-green-700 shadow-md transition-all hover:-translate-y-0.5"
                    >
                      <CheckCircle className="w-5 h-5" />
                      Hoàn thành
                    </button>
                  )}
                  {isSubmitted && isStudentMode && !formSubmitted && !isReviewMode && (
                     <span className="text-sm text-slate-500 italic flex items-center gap-1">
                        <Save className="w-4 h-4" /> Hãy bấm "Nộp Kết Quả" ở thanh dưới cùng.
                     </span>
                  )}
                  {formSubmitted && (
                     <span className="text-sm text-green-600 font-bold flex items-center gap-1">
                        <CheckCircle className="w-4 h-4" /> Đã gửi kết quả cho giáo viên.
                     </span>
                  )}
                </div>

                <div className="flex gap-2 w-full sm:w-auto justify-end">
                  {/* Teacher Create Mode Actions */}
                  {!isStudentMode && !isReviewMode && (
                    <>
                      <button 
                         onClick={handleSaveExerciseToDrive}
                         disabled={loadingStatus === 'uploading'}
                         className="flex items-center gap-2 px-3 py-2 bg-indigo-50 text-indigo-700 font-medium rounded-lg hover:bg-indigo-100 transition-colors border border-indigo-200"
                      >
                        {loadingStatus === 'uploading' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        {loadingStatus === 'uploading' ? 'Đang lưu...' : 'Lưu Đề (Drive)'}
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
                        disabled={loadingStatus !== 'idle'}
                        className="flex items-center gap-2 px-3 py-2 border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-50 transition-colors"
                      >
                        <RefreshCw className={`w-4 h-4 ${loadingStatus !== 'idle' ? 'animate-spin' : ''}`} />
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

            {/* Share Link Modal/Area (Teacher) */}
            {shareLink && !isStudentMode && !isReviewMode && (
              <div className="mb-6 bg-blue-50 border border-blue-200 p-4 rounded-xl animate-fade-in">
                <div className="flex items-center gap-2 mb-2 text-blue-800 font-semibold">
                   <Share2 className="w-4 h-4" /> Link bài tập (Đã nhúng Form nộp bài)
                </div>
                <div className="flex gap-2 relative">
                   <input 
                      type="text" 
                      readOnly 
                      value={shareLink} 
                      className="w-full bg-white border border-blue-200 rounded-lg px-3 py-2 text-sm text-slate-600 focus:outline-none"
                   />
                   <button 
                      onClick={() => handleCopyLink(shareLink)}
                      className={`px-4 py-2 rounded-lg font-medium text-sm transition-all whitespace-nowrap ${
                        linkCopied 
                        ? 'bg-green-100 text-green-800 border-2 border-green-500' 
                        : 'bg-blue-100 hover:bg-blue-200 text-blue-800'
                      }`}
                   >
                     {linkCopied ? (
                       <span className="flex items-center gap-1">
                         <CheckCircle className="w-4 h-4" /> Đã copy!
                       </span>
                     ) : (
                       <span className="flex items-center gap-1">
                         <Copy className="w-4 h-4" /> Copy Link
                       </span>
                     )}
                   </button>
                </div>
                <div className="flex gap-2 mt-3 items-start">
                  <Cloud className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-blue-700">
                    Gửi link này cho học viên. Kết quả nộp sẽ tự động bay về Google Form (Sheet) của bạn.
                  </p>
                </div>
              </div>
            )}

            {/* Content Render */}
            {content && (
              <div className="space-y-8 print:space-y-4">
                <div className="text-center mb-8 border-b border-slate-200 pb-6">
                  <h1 className="text-3xl font-bold text-slate-900 mb-2">
                    {isReviewMode ? `Review Result: ${studentName}` : (isStudentMode ? 'Student Assessment' : 'English Worksheet')}
                  </h1>
                  <p className="text-slate-500">
                    {preferences.topic || content.sections[0]?.title}
                  </p>
                </div>

                {content.sections.map((section, sIdx) => (
                  <ExerciseCard 
                    key={`${section.id}-${sIdx}`} 
                    section={section} 
                    sectionIndex={sIdx}
                    userAnswers={userAnswers}
                    onAnswerSelect={handleAnswerSelect}
                    isSubmitted={isSubmitted} // Lock inputs if submitted
                    showAnswersGlobal={showAnswers} 
                  />
                ))}
              </div>
            )}

          </div>
        </div>
      </main>

      {/* STICKY SUBMIT BAR - Student Mode Only (Floating at bottom) */}
      {isStudentMode && content && !isSubmitted && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t-4 border-indigo-500 shadow-2xl z-40 print:hidden animate-slide-up">
          <div className="max-w-5xl mx-auto px-4 py-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex-1">
                <p className="text-slate-800 font-semibold text-lg">
                  📝 Đã hoàn thành bài làm?
                </p>
                <p className="text-slate-500 text-sm">
                  Bấm nút bên phải để nộp bài và xem kết quả
                </p>
              </div>
              <button 
                onClick={handleSubmit}
                className="flex items-center gap-2 px-8 py-4 bg-gradient-to-r from-green-600 to-emerald-600 text-white font-bold rounded-xl hover:from-green-700 hover:to-emerald-700 shadow-lg transition-all hover:scale-105 active:scale-95 hover:shadow-xl"
              >
                <CheckCircle className="w-6 h-6" />
                <span className="text-lg">Nộp Bài</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* STICKY RESULT BAR - After submission (show feedback prompt) */}
      {isStudentMode && isSubmitted && !formSubmitted && (
        <div className="fixed bottom-0 left-0 right-0 bg-gradient-to-r from-indigo-600 to-purple-600 shadow-2xl z-40 print:hidden animate-slide-up">
          <div className="max-w-5xl mx-auto px-4 py-4">
            <div className="flex items-center justify-between gap-4 text-white">
              <div className="flex-1">
                <p className="font-bold text-lg flex items-center gap-2">
                  <Trophy className="w-5 h-5 text-yellow-300" />
                  Điểm: {scoreData?.correct} / {scoreData?.total}
                </p>
                <p className="text-indigo-100 text-sm">
                  Đừng quên nộp kết quả cho giáo viên nhé!
                </p>
              </div>
              <button 
                onClick={() => setShowSaveModal(true)}
                className="flex items-center gap-2 px-8 py-4 bg-white text-indigo-700 font-bold rounded-xl hover:bg-indigo-50 shadow-lg transition-all hover:scale-105 active:scale-95"
              >
                <Save className="w-6 h-6" />
                <span className="text-lg">Nộp Kết Quả</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Success message after form submission */}
      {formSubmitted && (
        <div className="fixed bottom-0 left-0 right-0 bg-green-600 shadow-2xl z-40 print:hidden animate-slide-up">
          <div className="max-w-5xl mx-auto px-4 py-3">
            <p className="text-white font-bold text-center flex items-center justify-center gap-2">
              <CheckCircle className="w-5 h-5" />
              ✅ Đã nộp bài thành công! Giáo viên đã nhận được kết quả.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;