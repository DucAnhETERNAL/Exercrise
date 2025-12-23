import React, { createContext, useContext, useState, ReactNode } from 'react';
import AlertModal, { AlertType } from '../components/AlertModal';

interface AlertContextType {
  showAlert: (message: string, type?: AlertType) => void;
}

const AlertContext = createContext<AlertContextType | undefined>(undefined);

export const AlertProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [alertState, setAlertState] = useState<{
    isOpen: boolean;
    message: string;
    type: AlertType;
  }>({
    isOpen: false,
    message: '',
    type: 'info',
  });

  const showAlert = (message: string, type: AlertType = 'info') => {
    setAlertState({
      isOpen: true,
      message,
      type,
    });
  };

  const closeAlert = () => {
    setAlertState({
      isOpen: false,
      message: '',
      type: 'info',
    });
  };

  return (
    <AlertContext.Provider value={{ showAlert }}>
      {children}
      <AlertModal
        isOpen={alertState.isOpen}
        message={alertState.message}
        type={alertState.type}
        onClose={closeAlert}
        autoClose={alertState.type === 'success'}
        autoCloseDelay={alertState.type === 'success' ? 3000 : 5000}
      />
    </AlertContext.Provider>
  );
};

export const useAlert = () => {
  const context = useContext(AlertContext);
  if (!context) {
    throw new Error('useAlert must be used within an AlertProvider');
  }
  return context;
};

