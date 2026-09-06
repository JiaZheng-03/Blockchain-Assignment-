import { useEffect, useState } from 'react';

function NoticeToasts() {
  const [toasts, setToasts] = useState([]);
  useEffect(() => {
    const showActionResult = (event) => {
      const message = String(event.detail?.message || '').trim();
      const type = event.detail?.type === 'error' ? 'error' : 'success';
      if (!message) return;
      setToasts((current) => [
        ...current,
        { id: crypto.randomUUID(), message, type },
      ]);
    };
    window.addEventListener('cargoseal:action-result', showActionResult);
    return () => window.removeEventListener('cargoseal:action-result', showActionResult);
  }, []);

  const dismissCurrent = () => {
    setToasts((current) => current.slice(1));
  };

  const currentToast = toasts[0];

  if (!currentToast) return null;

  return (
    <div className="toast-backdrop" role="presentation">
      <section
        aria-describedby="notice-popup-message"
        aria-labelledby="notice-popup-title"
        aria-modal="true"
        className={`toast-popup ${currentToast.type}`}
        role="alertdialog"
      >
        <h2 id="notice-popup-title">
          {currentToast.type === 'error' ? 'ERROR!' : 'SUCCESS'}
        </h2>
        <div className="toast-message" id="notice-popup-message">
          <strong>
            {currentToast.type === 'error'
              ? 'We could not complete your request.'
              : 'Thank you for your request.'}
          </strong>
          <p>{currentToast.message}</p>
        </div>
        <button autoFocus onClick={dismissCurrent} type="button">
          {currentToast.type === 'error' ? 'Try Again' : 'Continue'}
        </button>
      </section>
    </div>
  );
}

export default NoticeToasts;
