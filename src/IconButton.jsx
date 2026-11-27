import React from 'react';

export function IconButton({ label, children, pressed, spinning, onClick, disabled }) {
  return <button type="button" className={'icon-button' + (spinning ? ' spinning' : '')}
    aria-label={label} title={label} aria-pressed={pressed} onClick={onClick} disabled={disabled}>{children}</button>;
}
