import React from 'react';

const INK_THEMES = new Set(['desktop', 'liquid']);

const INK_OPTIONS = [
  ['light', '浅字'],
  ['dark', '深墨'],
];

export function CountdownThemePicker({ themes = [], theme, ink = 'light', onTheme, onInk }) {
  const showInk = INK_THEMES.has(theme);

  return (
    <section className="countdown-theme-picker" aria-label="倒计时主题设置">
      <div className="countdown-theme-grid" role="group" aria-label="材质主题">
        {themes.map(([id, label]) => {
          const selected = theme === id;
          return (
            <button
              key={id}
              type="button"
              className="countdown-theme-option"
              aria-pressed={selected}
              data-theme-id={id}
              onClick={() => onTheme?.(id)}
            >
              <span
                className="countdown-theme-swatch"
                data-theme-swatch={id}
                aria-hidden="true"
              >
                <span className="countdown-theme-swatch-bar countdown-theme-swatch-bar--main" />
                <span className="countdown-theme-swatch-bar countdown-theme-swatch-bar--sub" />
              </span>
              <span className="countdown-theme-label">{label}</span>
            </button>
          );
        })}
      </div>

      {showInk && (
        <div className="countdown-ink-row" role="group" aria-label="文字墨色">
          <span className="countdown-ink-title">文字墨色</span>
          <div className="countdown-ink-group">
            {INK_OPTIONS.map(([value, label]) => {
              const selected = ink === value;
              return (
                <button
                  key={value}
                  type="button"
                  className="countdown-ink-button"
                  aria-pressed={selected}
                  data-ink-option={value}
                  onClick={() => onInk?.(value)}
                >
                  <span
                    className={`countdown-ink-dot countdown-ink-dot--${value}`}
                    aria-hidden="true"
                  />
                  <span>{label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
