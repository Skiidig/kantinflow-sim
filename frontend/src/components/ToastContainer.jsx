import Icon from './Icon.jsx';

const TOAST_ICONS = {
  success: 'checkCircle',
  error: 'alertCircle',
  warning: 'alertTriangle',
  info: 'info',
};

export default function ToastContainer({ toasts, onDismiss }) {
  if (!toasts.length) return null;

  return (
    <div className="toast-stack" aria-live="polite" aria-atomic="false">
      {toasts.map((toast) => {
        const type = toast.type ?? 'info';
        return (
          <div
            key={toast.id}
            className={`toast toast--${type}`}
            role={type === 'error' ? 'alert' : 'status'}
          >
            <span className={`toast-icon toast-icon--${type}`} aria-hidden="true">
              <Icon name={TOAST_ICONS[type] ?? 'info'} size={18} />
            </span>
            <div className="toast-body">
              {toast.title && <strong>{toast.title}</strong>}
              <p>{toast.message}</p>
            </div>
            <button
              type="button"
              className="toast-close"
              onClick={() => onDismiss(toast.id)}
              aria-label="Tutup notifikasi"
            >
              <Icon name="close" size={16} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
