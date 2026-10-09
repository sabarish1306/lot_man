import { useEffect, useRef, useState } from "react";
import { ImageOff, X } from "lucide-react";

export default function ImagePreview({
  url,
  name,
  onClose,
}: {
  url: string;
  name: string;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const element = dialog.current!;
    const previous = document.activeElement as HTMLElement | null;
    element.showModal();
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      element.close();
      document.body.style.overflow = oldOverflow;
      previous?.focus();
    };
  }, []);

  return (
    <dialog
      ref={dialog}
      className="image-dialog"
      aria-labelledby="preview-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="dialog-content">
        <header>
          <div>
            <h2 id="preview-title">Source image preview</h2>
            <p>{name}</p>
          </div>
          <button
            autoFocus
            className="icon-button"
            aria-label="Close image preview"
            onClick={onClose}
          >
            <X size={21} />
          </button>
        </header>
        <div className="preview-body">
          {failed ? (
            <div className="image-unavailable">
              <ImageOff size={30} />
              <p>
                This image could not be loaded. It may be unavailable or
                corrupt.
              </p>
            </div>
          ) : (
            <img
              src={url}
              alt={`Enlarged source image: ${name}`}
              onError={() => setFailed(true)}
            />
          )}
        </div>
        <footer>
          Inspect the original digits carefully. This image has not been
          verified.
        </footer>
      </div>
    </dialog>
  );
}
