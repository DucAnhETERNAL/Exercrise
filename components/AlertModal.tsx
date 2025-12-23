import React, { useEffect } from 'react';
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react';

export type AlertType = 'success' | 'error' | 'warning' | 'info';

interface AlertModalProps {
  isOpen: boolean;
  message: string;
  type?: AlertType;
  onClose: () => void;
  autoClose?: boolean;
  autoCloseDelay?: number;
}

const AlertModal: React.FC<AlertModalProps> = ({
  isOpen,
  message,
  type = 'info',
  onClose,
  autoClose = true,
  autoCloseDelay = 3000,
}) => {
  useEffect(() => {
    if (isOpen && autoClose) {
      const timer = setTimeout(() => {
        onClose();
      }, autoCloseDelay);
      return () => clearTimeout(timer);
    }
  }, [isOpen, autoClose, autoCloseDelay, onClose]);

  if (!isOpen) return null;

  const getIcon = () => {
    switch (type) {
      case 'success':
        return <CheckCircle className="w-6 h-6" />;
      case 'error':
        return <AlertCircle className="w-6 h-6" />;
      case 'warning':
        return <AlertTriangle className="w-6 h-6" />;
      case 'info':
      default:
        return <Info className="w-6 h-6" />;
    }
  };

  const getColors = () => {
    switch (type) {
      case 'success':
        return {
          bg: 'bg-green-500',
          text: 'text-white',
          button: 'bg-green-600 hover:bg-green-700',
        };
      case 'error':
        return {
          bg: 'bg-red-500',
          text: 'text-white',
          button: 'bg-red-600 hover:bg-red-700',
        };
      case 'warning':
        return {
          bg: 'bg-yellow-500',
          text: 'text-white',
          button: 'bg-yellow-600 hover:bg-yellow-700',
        };
      case 'info':
      default:
        return {
          bg: 'bg-blue-500',
          text: 'text-white',
          button: 'bg-blue-600 hover:bg-blue-700',
        };
    }
  };

  const colors = getColors();

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-slide-up">
        <div className={`${colors.bg} px-6 py-4 flex items-center justify-between`}>
          <div className={`flex items-center gap-3 ${colors.text}`}>
            {getIcon()}
            <h3 className="font-bold text-lg">
              {type === 'success' && 'Thành công'}
              {type === 'error' && 'Lỗi'}
              {type === 'warning' && 'Cảnh báo'}
              {type === 'info' && 'Thông báo'}
            </h3>
          </div>
          <button
            onClick={onClose}
            className={`${colors.text} opacity-80 hover:opacity-100 transition-opacity`}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6">
          <p className="text-slate-700 text-base leading-relaxed whitespace-pre-line">
            {message}
          </p>
        </div>

        <div className="px-6 pb-6">
          <button
            onClick={onClose}
            className={`w-full ${colors.button} text-white font-semibold py-3 px-6 rounded-lg transition-colors shadow-sm hover:shadow-md`}
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
};

export default AlertModal;

