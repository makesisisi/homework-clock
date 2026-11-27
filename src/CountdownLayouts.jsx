import React from 'react';

const COUNTDOWN_LAYOUTS = [
  { id: "standard", label: "横条" },
  { id: "tiles", label: "方形" },
  { id: "dial", label: "圆形" },
  { id: "days", label: "竖卡" },
];

export function CountdownDigits({
  layout = "standard",
  days = 0,
  units = ["00", "00", "00"],
  clock = "00:00:00",
  finished = false,
  remainingFraction = 1,
}) {
  if (layout === "standard") {
    if (finished) return <span className="countdown-finished">已到时间</span>;
    return (
      <>
        {days > 0 && (
          <span>
            {days}
            <small>天</small>
          </span>
        )}
        <span>{clock}</span>
      </>
    );
  }

  const [hh, mm, ss] = units;
  const longDays = days >= 10000 ? "1" : undefined;

  if (layout === "tiles") {
    if (finished) {
      return (
        <div className="cd-tiles" data-done="1">
          <div className="cd-tile cd-tile-done">
            <strong>已到时间</strong>
            <small>{clock}</small>
          </div>
        </div>
      );
    }
    const items = [
      ...(days > 0 ? [{ v: String(days), u: "天", k: "d", wide: true }] : []),
      { v: hh, u: "时", k: "h" },
      { v: mm, u: "分", k: "m" },
      { v: ss, u: "秒", k: "s" },
    ];
    return (
      <div className="cd-tiles" data-long={longDays}>
        {items.map((it) => (
          <div className="cd-tile" data-wide={it.wide ? "1" : undefined} key={it.k}>
            <strong>{it.v}</strong>
            <small>{it.u}</small>
          </div>
        ))}
      </div>
    );
  }

  if (layout === "dial") {
    const p = finished ? 0 : Math.max(0, Math.min(1, remainingFraction));
    return (
      <div className="cd-dial" data-done={finished ? "1" : undefined} data-long={longDays}>
        <div className="cd-ring" style={{ "--cd-p": p }} title="最后 24 小时的剩余比例" aria-hidden="true">
          <span>{finished ? "0%" : `${Math.round(p * 100)}%`}</span>
          <small>24h</small>
        </div>
        <div className="cd-dial-info">
          {finished ? (
            <>
              <strong className="cd-done-text">已到时间</strong>
              <span className="cd-sub-clock">{clock}</span>
            </>
          ) : (
            <>
              {days > 0 && (
                <span className="cd-dial-days">
                  {days}
                  <small>天</small>
                </span>
              )}
              <strong className="cd-dial-clock">{clock}</strong>
            </>
          )}
        </div>
      </div>
    );
  }

  // days: 大字天数（最后一天改大字小时 + 分秒）
  const isLastDay = days <= 0;
  return (
    <div className="cd-days" data-done={finished ? "1" : undefined} data-long={longDays}>
      {finished ? (
        <>
          <strong className="cd-done-text">已到时间</strong>
          <span className="cd-sub-clock">{clock}</span>
        </>
      ) : (
        <>
          <div className="cd-hero">
            <strong>{isLastDay ? Number(hh) : days}</strong>
            <small>{isLastDay ? "小时" : "天"}</small>
          </div>
          <div className="cd-side">
            <strong>{isLastDay ? `${mm}:${ss}` : clock}</strong>
            <small>{isLastDay ? "分 : 秒" : "剩余计时"}</small>
          </div>
        </>
      )}
    </div>
  );
}

export function CountdownLayoutPicker({ layout = "standard", onLayout }) {
  return (
    <fieldset className="cd-layout-options">
      <legend>显示形式</legend>
      <div className="cd-layout-picker">
        {COUNTDOWN_LAYOUTS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            className="cd-layout-opt"
            aria-pressed={layout === id}
            onClick={() => onLayout(id)}
          >
            <span className={`cd-thumb cd-thumb-${id}`} aria-hidden="true" />
            <span>{label}</span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}
