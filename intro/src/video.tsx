import React from 'react';
import { AbsoluteFill, Html5Audio, Img, interpolate, staticFile, useCurrentFrame } from 'remotion';

const C = {
  bg: '#07111e',
  deep: '#0b1728',
  panel: '#11263a',
  white: '#f5fbff',
  muted: '#a5b6c7',
  cyan: '#33d7ef',
  mint: '#9cf8c7',
  pink: '#ff66ae',
  amber: '#ffd596',
};

const font = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';
const display = '"Avenir Next", "PingFang SC", sans-serif';
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const smooth = (n: number) => {
  const x = clamp(n);
  return x * x * (3 - 2 * x);
};
const inAt = (f: number, at: number, dur = 18) => smooth((f - at) / dur);
const outAt = (f: number, at: number, dur = 18) => 1 - smooth((f - at) / dur);
const scene = (f: number, start: number, end: number) =>
  inAt(f, start, 15) * outAt(f, end - 15, 15);
const lift = (f: number, at: number, px = 55) => px * (1 - inAt(f, at, 25));

const Frame: React.FC<{
  children: React.ReactNode;
  opacity?: number;
  style?: React.CSSProperties;
}> = ({ children, opacity = 1, style }) => (
  <AbsoluteFill style={{ opacity, ...style }}>{children}</AbsoluteFill>
);

const Kicker: React.FC<{
  children: React.ReactNode;
  color?: string;
  style?: React.CSSProperties;
}> = ({ children, color = C.mint, style }) => (
  <div
    style={{
      fontFamily: display,
      color,
      letterSpacing: 5,
      fontWeight: 800,
      fontSize: 24,
      ...style,
    }}
  >
    {children}
  </div>
);

const _MiniLogo: React.FC = () => (
  <div
    style={{
      position: 'absolute',
      top: 64,
      left: 98,
      display: 'flex',
      alignItems: 'center',
      gap: 18,
      zIndex: 20,
    }}
  >
    <Img
      src={staticFile('tray-icon.png')}
      style={{ width: 54, height: 54, objectFit: 'contain', imageRendering: 'pixelated' }}
    />
    <span
      style={{
        fontFamily: display,
        fontSize: 29,
        fontWeight: 900,
        letterSpacing: 5,
        color: C.white,
      }}
    >
      ROVER
    </span>
  </div>
);

const Background: React.FC<{ f: number }> = ({ f }) => {
  const shift = Math.sin(f / 90) * 85;
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(ellipse 950px 650px at ${58 + shift / 30}% 45%, #153650 0%, #0c1d31 40%, ${C.bg} 88%)`,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          opacity: 0.16,
          backgroundImage:
            'linear-gradient(#80deed20 1px, transparent 1px), linear-gradient(90deg, #80deed20 1px, transparent 1px)',
          backgroundSize: '70px 70px',
          transform: `translate(${(f * -0.1) % 70}px, ${(f * 0.06) % 70}px)`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          width: 1000,
          height: 1000,
          left: 1100 + shift,
          top: -420,
          borderRadius: '50%',
          background: 'radial-gradient(circle, #1b9fac23 0%, transparent 65%)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          width: 700,
          height: 700,
          left: -300,
          top: 630,
          borderRadius: '50%',
          background: 'radial-gradient(circle, #fb4fa71b 0%, transparent 70%)',
        }}
      />
      {Array.from({ length: 42 }, (_, i) => {
        const x = (i * 397 + 139) % 1900;
        const y = (i * 263 + 87) % 1060;
        const a = 0.13 + 0.14 * Math.sin((f + i * 27) / 34);
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: x,
              top: y,
              width: i % 7 === 0 ? 4 : 2,
              height: i % 7 === 0 ? 4 : 2,
              background: i % 3 ? C.cyan : C.mint,
              opacity: a,
              borderRadius: 2,
            }}
          />
        );
      })}
      <div
        style={{ position: 'absolute', inset: 38, border: '1px solid #7ccad018', borderRadius: 34 }}
      />
    </AbsoluteFill>
  );
};

const StatusPill: React.FC<{ label: string; tone: 'mint' | 'pink' | 'amber' }> = ({
  label,
  tone,
}) => {
  const color = tone === 'mint' ? C.mint : tone === 'pink' ? C.pink : C.amber;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 9,
        border: `1px solid ${color}55`,
        background: `${color}18`,
        color,
        padding: '9px 16px',
        borderRadius: 100,
        fontSize: 20,
        fontWeight: 700,
      }}
    >
      <span
        style={{
          width: 9,
          height: 9,
          borderRadius: '50%',
          background: color,
          boxShadow: `0 0 12px ${color}`,
        }}
      />
      {label}
    </span>
  );
};

const Window: React.FC<{
  title: string;
  width: number;
  height: number;
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ title, width, height, children, style }) => (
  <div
    style={{
      width,
      height,
      borderRadius: 24,
      border: '1px solid #8bd6e044',
      background: 'linear-gradient(145deg, #183249, #0d1c30)',
      boxShadow: '0 36px 100px #020a15a8, inset 0 1px #ffffff22',
      overflow: 'hidden',
      ...style,
    }}
  >
    <div
      style={{
        height: 53,
        borderBottom: '1px solid #ffffff19',
        display: 'flex',
        alignItems: 'center',
        padding: '0 24px',
        gap: 8,
        color: '#90a7bb',
        fontFamily: display,
        fontWeight: 700,
        fontSize: 16,
      }}
    >
      <i style={{ width: 10, height: 10, background: C.pink, borderRadius: '50%' }} />
      <i style={{ width: 10, height: 10, background: C.amber, borderRadius: '50%' }} />
      <i style={{ width: 10, height: 10, background: C.mint, borderRadius: '50%' }} />
      <span style={{ marginLeft: 14, letterSpacing: 1.5 }}>{title}</span>
    </div>
    {children}
  </div>
);

const TaskCard: React.FC<{
  title: string;
  subtitle: string;
  status: string;
  tone: 'mint' | 'pink' | 'amber';
  width?: number;
  progress?: number;
}> = ({ title, subtitle, status, tone, width = 610, progress }) => (
  <div
    style={{
      width,
      minHeight: 159,
      borderRadius: 25,
      border: '1px solid #a8d8e43a',
      background: 'linear-gradient(115deg, #1c3a50f5, #13253af5)',
      padding: '24px 30px',
      boxShadow: '0 25px 65px #03101b88, inset 0 1px #ffffff24',
      boxSizing: 'border-box',
    }}
  >
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ color: C.white, fontSize: 29, fontWeight: 750, letterSpacing: -1 }}>
        {title}
      </span>
      <StatusPill label={status} tone={tone} />
    </div>
    <div style={{ color: C.muted, fontSize: 21, marginTop: 16 }}>{subtitle}</div>
    {progress !== undefined && (
      <div
        style={{
          height: 6,
          borderRadius: 6,
          marginTop: 20,
          background: '#ffffff1c',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${progress}%`,
            background: `linear-gradient(90deg, ${C.cyan}, ${C.mint})`,
            borderRadius: 6,
          }}
        />
      </div>
    )}
  </div>
);

const Chaos: React.FC<{ f: number }> = ({ f }) => {
  const s = 0,
    e = 135;
  return (
    <Frame opacity={scene(f, s, e)}>
      <div
        style={{
          position: 'absolute',
          left: 152,
          top: 322,
          transform: `translateY(${lift(f, 4)}px)`,
        }}
      >
        <Kicker>THE NEW WORKDAY / 01</Kicker>
        <div
          style={{
            fontSize: 98,
            lineHeight: 1.2,
            fontWeight: 800,
            letterSpacing: -5,
            color: C.white,
            marginTop: 36,
          }}
        >
          Agent 越多，
        </div>
        <div
          style={{
            fontSize: 76,
            lineHeight: 1.3,
            fontWeight: 800,
            letterSpacing: -4,
            background: `linear-gradient(90deg, ${C.white}, ${C.cyan})`,
            backgroundClip: 'text',
            color: 'transparent',
            whiteSpace: 'nowrap',
          }}
        >
          进展越难一眼看清。
        </div>
        <div
          style={{
            height: 4,
            width: 310 * inAt(f, 30, 28),
            marginTop: 38,
            background: `linear-gradient(90deg, ${C.pink}, ${C.cyan})`,
            borderRadius: 3,
          }}
        />
      </div>
      <div
        style={{
          position: 'absolute',
          left: 1085,
          top: 210,
          transform: `rotate(-8deg) translateY(${lift(f, 10, 110)}px)`,
          opacity: inAt(f, 10, 18),
        }}
      >
        <Window title="CODEX / FEATURE BRANCH" width={570} height={225}>
          <div
            style={{
              padding: '26px 31px',
              fontSize: 21,
              lineHeight: 1.8,
              color: '#9de6de',
              fontFamily: 'monospace',
            }}
          >
            ↳ Fixing checkout flow
            <br />
            <span style={{ color: '#a7b8ce' }}> Running tests...</span>
            <br />
            <span style={{ color: C.pink }}>● needs review</span>
          </div>
        </Window>
      </div>
      <div
        style={{
          position: 'absolute',
          left: 1185,
          top: 453,
          transform: `rotate(5deg) translateY(${lift(f, 20, 130)}px)`,
          opacity: inAt(f, 20, 18),
        }}
      >
        <Window title="CLAUDE CODE / RELEASE" width={585} height={214}>
          <div style={{ padding: '27px 31px', fontSize: 24, color: C.white }}>
            QA 发布准备
            <div style={{ fontSize: 18, marginTop: 16, color: C.muted }}>
              等待用户确认 · 6 分钟前
            </div>
          </div>
        </Window>
      </div>
      <div
        style={{
          position: 'absolute',
          left: 1000,
          top: 700,
          transform: `rotate(-4deg) translateY(${lift(f, 30, 115)}px)`,
          opacity: inAt(f, 30, 18),
        }}
      >
        <Window title="TASK / INCIDENT-482" width={550} height={165}>
          <div style={{ padding: '25px 31px', fontSize: 23, color: C.white }}>
            线上结算页白屏 <span style={{ color: C.amber, marginLeft: 18 }}>● 处理中</span>
          </div>
        </Window>
      </div>
      <div
        style={{
          position: 'absolute',
          right: 180,
          bottom: 85,
          color: '#7da4b1',
          fontFamily: display,
          fontSize: 19,
          letterSpacing: 4,
        }}
      >
        01 / 06
      </div>
    </Frame>
  );
};

const Reveal: React.FC<{ f: number }> = ({ f }) => {
  const start = 135,
    end = 240;
  const local = f - start;
  const p = inAt(f, start + 10, 30);
  return (
    <Frame opacity={scene(f, start, end)}>
      <div
        style={{
          position: 'absolute',
          left: 525,
          top: -210,
          width: 870,
          height: 870,
          border: '1px solid #5ce4e445',
          borderRadius: '50%',
          transform: `scale(${0.8 + 0.2 * p})`,
          opacity: 0.65,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 605,
          top: -130,
          width: 710,
          height: 710,
          border: '1px solid #9cf8c74d',
          borderRadius: '50%',
          transform: `scale(${1.15 - 0.15 * p})`,
          opacity: 0.6,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 705,
          top: 92,
          width: 510,
          height: 510,
          borderRadius: '50%',
          background: 'radial-gradient(circle, #35def35c, #7ef4ca1c 44%, transparent 70%)',
          filter: 'blur(18px)',
        }}
      />
      <Img
        src={staticFile('app-icon.png')}
        style={{
          position: 'absolute',
          left: 790,
          top: 142 + (1 - p) * 80 + Math.sin(local / 12) * 5,
          width: 340,
          height: 340,
          objectFit: 'contain',
          imageRendering: 'pixelated',
          transform: `scale(${0.65 + 0.35 * p}) rotate(${(1 - p) * -12}deg)`,
          filter: 'drop-shadow(0 35px 65px #3ce7e455)',
          opacity: p,
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: 515,
          left: 0,
          right: 0,
          textAlign: 'center',
          transform: `translateY(${lift(f, start + 23)}px)`,
          opacity: inAt(f, start + 23),
        }}
      >
        <Kicker color={C.cyan}>INTRODUCING</Kicker>
        <div
          style={{
            fontFamily: display,
            color: C.white,
            fontSize: 155,
            letterSpacing: 22,
            fontWeight: 900,
            lineHeight: 1.4,
            textShadow: '0 0 60px #7dfae344',
          }}
        >
          ROVER
        </div>
        <div style={{ color: C.mint, fontSize: 44, fontWeight: 700, letterSpacing: 5 }}>
          你的桌面 Agent 搭档
        </div>
      </div>
      {Array.from({ length: 13 }, (_, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            left: 438 + ((i * 159) % 1060),
            top: 132 + ((i * 331) % 620),
            width: i % 3 ? 9 : 15,
            height: i % 3 ? 9 : 15,
            background: i % 4 ? C.cyan : C.pink,
            opacity: 0.5 * p * (0.6 + 0.4 * Math.sin((f + i * 17) / 10)),
            boxShadow: `0 0 24px ${C.cyan}`,
          }}
        />
      ))}
    </Frame>
  );
};

const Dispatch: React.FC<{ f: number }> = ({ f }) => {
  const start = 240,
    end = 390,
    typed = '帮我排查结算页白屏';
  const chars = Math.floor(clamp((f - 265) / 35) * typed.length);
  const route = inAt(f, 293, 30);
  return (
    <Frame opacity={scene(f, start, end)}>
      <div
        style={{
          position: 'absolute',
          left: 155,
          top: 170,
          transform: `translateY(${lift(f, start + 5)}px)`,
        }}
      >
        <Kicker>01 / HAND OFF</Kicker>
        <div
          style={{
            fontSize: 104,
            color: C.white,
            fontWeight: 800,
            lineHeight: 1.15,
            marginTop: 30,
            letterSpacing: -5,
          }}
        >
          说出目标。
        </div>
        <div
          style={{ fontSize: 60, color: C.mint, fontWeight: 750, marginTop: 12, letterSpacing: -3 }}
        >
          下一步，自有人接手。
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          left: 160,
          top: 474,
          width: 850,
          height: 125,
          borderRadius: 34,
          border: '2px solid #a6f0dc80',
          background: 'linear-gradient(100deg,#eaf9f8,#d5f5f3)',
          boxShadow: '0 25px 90px #66e6da3a',
          display: 'flex',
          alignItems: 'center',
          padding: '0 42px',
          boxSizing: 'border-box',
          opacity: inAt(f, 256, 20),
          transform: `translateY(${lift(f, 256, 45)}px)`,
        }}
      >
        <div style={{ fontSize: 35, color: '#18384d', fontWeight: 650 }}>
          {typed.slice(0, chars)}
          <span style={{ color: '#008fa1', opacity: Math.sin(f / 5) > 0 ? 1 : 0 }}>│</span>
        </div>
        <div
          style={{
            marginLeft: 'auto',
            width: 62,
            height: 62,
            borderRadius: '50%',
            background: '#00bfd2',
            color: '#fff',
            fontSize: 40,
            display: 'grid',
            placeItems: 'center',
            fontFamily: display,
          }}
        >
          ↑
        </div>
      </div>
      <svg
        style={{
          position: 'absolute',
          left: 982,
          top: 501,
          width: 274,
          height: 262,
          overflow: 'visible',
          opacity: route,
        }}
        viewBox="0 0 274 262"
      >
        <path
          d="M0 42 C122 42 96 30 250 30 M0 42 C126 42 100 225 250 225"
          fill="none"
          stroke="#65e7db55"
          strokeWidth="4"
          strokeDasharray="8 10"
        />
        <path
          d="M0 42 C122 42 96 30 250 30"
          fill="none"
          stroke={C.mint}
          strokeWidth="5"
          strokeDasharray={`${340 * route} 400`}
        />
        <path
          d="M0 42 C126 42 100 225 250 225"
          fill="none"
          stroke={C.cyan}
          strokeWidth="5"
          strokeDasharray={`${390 * route} 450`}
        />
      </svg>
      <div
        style={{
          position: 'absolute',
          left: 1216,
          top: 454,
          opacity: inAt(f, 302, 18),
          transform: `translateX(${48 * (1 - inAt(f, 302, 18))}px)`,
        }}
      >
        <AgentBadge name="Claude Code" initials="C" color={C.mint} meta="任务会话已启动" />
      </div>
      <div
        style={{
          position: 'absolute',
          left: 1216,
          top: 652,
          opacity: inAt(f, 317, 18),
          transform: `translateX(${48 * (1 - inAt(f, 317, 18))}px)`,
        }}
      >
        <AgentBadge name="Codex" initials="◆" color={C.cyan} meta="可按目标选择" />
      </div>
      <div
        style={{
          position: 'absolute',
          left: 160,
          top: 680,
          opacity: inAt(f, 337, 18),
          transform: `translateY(${lift(f, 337, 40)}px)`,
        }}
      >
        <TaskCard
          title="结算页白屏排查"
          subtitle="Rover 已交给 Claude Code · Task 已建立"
          status="处理中"
          tone="mint"
          width={850}
          progress={50}
        />
      </div>
    </Frame>
  );
};

const AgentBadge: React.FC<{ name: string; initials: string; color: string; meta: string }> = ({
  name,
  initials,
  color,
  meta,
}) => (
  <div
    style={{
      width: 535,
      height: 157,
      display: 'flex',
      alignItems: 'center',
      gap: 24,
      padding: '25px 30px',
      boxSizing: 'border-box',
      border: '1px solid #97e3e060',
      borderRadius: 25,
      background: 'linear-gradient(115deg,#1d3b4c,#102338)',
      boxShadow: '0 25px 70px #02101f8c',
    }}
  >
    <div
      style={{
        width: 72,
        height: 72,
        borderRadius: 18,
        border: `2px solid ${color}`,
        color,
        display: 'grid',
        placeItems: 'center',
        fontSize: 37,
        fontWeight: 900,
        boxShadow: `0 0 26px ${color}44`,
      }}
    >
      {initials}
    </div>
    <div>
      <div style={{ color: C.white, fontSize: 29, fontFamily: display, fontWeight: 750 }}>
        {name}
      </div>
      <div style={{ color: C.muted, fontSize: 19, marginTop: 8 }}>{meta}</div>
    </div>
    <span style={{ marginLeft: 'auto', fontSize: 35, color }}>↗</span>
  </div>
);

const Visibility: React.FC<{ f: number }> = ({ f }) => {
  const start = 390,
    end = 540;
  return (
    <Frame opacity={scene(f, start, end)}>
      <div
        style={{
          position: 'absolute',
          left: 153,
          top: 302,
          transform: `translateY(${lift(f, start + 8)}px)`,
        }}
      >
        <Kicker>02 / STAY IN VIEW</Kicker>
        <div
          style={{
            color: C.white,
            fontSize: 95,
            fontWeight: 800,
            lineHeight: 1.25,
            marginTop: 34,
            letterSpacing: -5,
          }}
        >
          每个任务，
          <br />
          <span style={{ color: C.mint }}>都看得见。</span>
        </div>
        <div style={{ color: C.muted, fontSize: 30, marginTop: 36, lineHeight: 1.6 }}>
          正在做什么、哪里需要你、
          <br />
          何时已经完成，一眼明白。
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          left: 985,
          top: 219,
          transform: `translateX(${(1 - inAt(f, 405, 25)) * 160}px) rotate(-3deg)`,
          opacity: inAt(f, 405, 22),
        }}
      >
        <TaskCard
          title="线上结算页白屏"
          subtitle="正在检查错误日志与代码变更"
          status="处理中"
          tone="mint"
          progress={Math.round(32 + 15 * Math.sin(f / 25))}
        />
      </div>
      <div
        style={{
          position: 'absolute',
          left: 1075,
          top: 442,
          transform: `translateX(${(1 - inAt(f, 425, 25)) * 190}px) rotate(3deg)`,
          opacity: inAt(f, 425, 22),
        }}
      >
        <TaskCard
          title="支付功能 QA 发布"
          subtitle="等待在原会话中确认部署"
          status="需确认"
          tone="amber"
        />
      </div>
      <div
        style={{
          position: 'absolute',
          left: 963,
          top: 670,
          transform: `translateX(${(1 - inAt(f, 445, 25)) * 210}px) rotate(-2deg)`,
          opacity: inAt(f, 445, 22),
        }}
      >
        <TaskCard
          title="每日健康巡检"
          subtitle="计划已建立 · 每天 09:30"
          status="已完成"
          tone="mint"
        />
      </div>
      <div
        style={{
          position: 'absolute',
          top: 131,
          right: 146,
          fontFamily: display,
          fontSize: 24,
          color: C.cyan,
          letterSpacing: 3,
          opacity: inAt(f, 460),
        }}
      >
        3 TASKS / ONE VIEW
      </div>
    </Frame>
  );
};

const Attention: React.FC<{ f: number }> = ({ f }) => {
  const start = 540,
    end = 675;
  const cue = inAt(f, 578, 23);
  return (
    <Frame opacity={scene(f, start, end)}>
      <div
        style={{
          position: 'absolute',
          left: 155,
          top: 155,
          transform: `translateY(${lift(f, start + 7)}px)`,
        }}
      >
        <Kicker>03 / RIGHT ON TIME</Kicker>
        <div
          style={{
            fontSize: 91,
            fontWeight: 800,
            color: C.white,
            letterSpacing: -5,
            marginTop: 26,
          }}
        >
          需要你时，<span style={{ color: C.amber }}>及时出现。</span>
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          left: 160,
          top: 373,
          opacity: inAt(f, 558, 20),
          transform: `translateY(${lift(f, 558, 55)}px)`,
        }}
      >
        <Window title="ORIGINAL AGENT SESSION" width={800} height={405}>
          <div
            style={{
              padding: '38px 43px',
              fontFamily: 'monospace',
              fontSize: 26,
              lineHeight: 2,
              color: '#b5e8d6',
            }}
          >
            <span style={{ color: C.cyan }}>$</span> claude --resume
            <br />
            <span style={{ color: '#b0c4d6' }}>已完成发布前检查。</span>
            <br />
            <span style={{ color: C.amber }}>→ 是否允许推送 QA 分支？</span>
            <br />
            <span style={{ color: C.muted, fontSize: 20 }}>等待你的决定 · 原会话继续</span>
          </div>
        </Window>
      </div>
      <div
        style={{
          position: 'absolute',
          left: 1040,
          top: 399,
          width: 650,
          height: 307,
          borderRadius: 32,
          border: `2px solid ${C.amber}a0`,
          background: 'linear-gradient(130deg,#244052,#172838)',
          padding: '35px 40px',
          boxSizing: 'border-box',
          boxShadow: `0 25px 95px #020914, 0 0 ${cue * 55}px ${C.amber}50`,
          opacity: cue,
          transform: `translateY(${lift(f, 578, 70)}px)`,
        }}
      >
        <div style={{ display: 'flex', gap: 25, alignItems: 'center' }}>
          <Img
            src={staticFile('tray-icon.png')}
            style={{ width: 75, height: 75, objectFit: 'contain', imageRendering: 'pixelated' }}
          />
          <div>
            <div
              style={{
                fontFamily: display,
                fontSize: 22,
                color: C.mint,
                fontWeight: 800,
                letterSpacing: 2,
              }}
            >
              ROVER 提醒
            </div>
            <div style={{ color: C.white, fontSize: 35, fontWeight: 750, marginTop: 7 }}>
              这项任务需要你确认
            </div>
          </div>
        </div>
        <div style={{ fontSize: 23, color: C.muted, marginTop: 26 }}>
          支付功能 QA 发布 · Claude Code
        </div>
        <div
          style={{
            display: 'inline-block',
            borderRadius: 14,
            padding: '12px 22px',
            marginTop: 22,
            background: C.amber,
            color: '#263749',
            fontWeight: 800,
            fontSize: 22,
          }}
        >
          返回原会话 →
        </div>
      </div>
      <svg
        style={{ position: 'absolute', left: 905, top: 529, overflow: 'visible', opacity: cue }}
        width="165"
        height="90"
      >
        <path
          d="M155 20 C72 20 90 70 0 70"
          fill="none"
          stroke={C.amber}
          strokeWidth="5"
          strokeDasharray={`${220 * cue} 250`}
        />
      </svg>
      <div
        style={{
          position: 'absolute',
          left: 164,
          top: 835,
          color: C.muted,
          fontSize: 25,
          opacity: inAt(f, 615),
        }}
      >
        在正确的时刻，回到正确的地方。
      </div>
    </Frame>
  );
};

const Finale: React.FC<{ f: number }> = ({ f }) => {
  const start = 675;
  const p = inAt(f, start + 5, 35);
  return (
    <Frame opacity={inAt(f, start, 16)}>
      <div
        style={{
          position: 'absolute',
          left: 510,
          top: 20,
          width: 900,
          height: 900,
          borderRadius: '50%',
          background: 'radial-gradient(circle,#25d4dc31 0%,#21b1c117 30%,transparent 67%)',
          transform: `scale(${0.8 + 0.2 * p})`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 678,
          top: 59,
          width: 565,
          height: 565,
          borderRadius: '50%',
          border: '1px solid #9cf8c75e',
          transform: `scale(${0.8 + 0.2 * p})`,
          opacity: 0.8,
        }}
      />
      <Img
        src={staticFile('app-icon.png')}
        style={{
          position: 'absolute',
          left: 801,
          top: 114,
          width: 318,
          height: 318,
          objectFit: 'contain',
          imageRendering: 'pixelated',
          opacity: p,
          transform: `translateY(${(1 - p) * 65}px) scale(${0.7 + 0.3 * p})`,
          filter: 'drop-shadow(0 30px 70px #59efdb77)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: 450,
          left: 0,
          right: 0,
          textAlign: 'center',
          opacity: inAt(f, 704, 25),
          transform: `translateY(${lift(f, 704, 50)}px)`,
        }}
      >
        <div
          style={{
            fontFamily: display,
            fontSize: 168,
            fontWeight: 900,
            letterSpacing: 22,
            color: C.white,
            lineHeight: 1.15,
            textShadow: '0 0 70px #7ff7dd33',
          }}
        >
          ROVER
        </div>
        <div
          style={{ fontSize: 68, fontWeight: 800, color: C.white, marginTop: 42, letterSpacing: 2 }}
        >
          专注创造。<span style={{ color: C.mint }}>其余交给 Rover。</span>
        </div>
        <div
          style={{
            fontFamily: display,
            fontSize: 23,
            color: C.cyan,
            letterSpacing: 6,
            marginTop: 41,
            fontWeight: 750,
          }}
        >
          YOUR DESKTOP AGENT COMPANION
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          left: 565,
          right: 565,
          bottom: 102,
          height: 3,
          background: `linear-gradient(90deg,transparent,${C.cyan},${C.pink},transparent)`,
          opacity: inAt(f, 742, 28),
        }}
      />
      {Array.from({ length: 9 }, (_, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            left: 494 + i * 119,
            top: 80 + ((i * 139) % 700),
            width: 8,
            height: 8,
            background: i % 3 ? C.cyan : C.pink,
            boxShadow: `0 0 22px ${i % 3 ? C.cyan : C.pink}`,
            opacity: p * 0.5 * (0.6 + 0.4 * Math.sin((f + i * 19) / 13)),
          }}
        />
      ))}
    </Frame>
  );
};

export const RoverLaunch: React.FC = () => {
  const f = useCurrentFrame();
  const fl = interpolate(f, [0, 16, 790, 809], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return (
    <AbsoluteFill
      style={{ fontFamily: font, backgroundColor: C.bg, color: C.white, overflow: 'hidden' }}
    >
      <Background f={f} />
      <Chaos f={f} />
      <Reveal f={f} />
      <Dispatch f={f} />
      <Visibility f={f} />
      <Attention f={f} />
      <Finale f={f} />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundColor: C.bg,
          opacity: 1 - fl,
          pointerEvents: 'none',
        }}
      />
      <Html5Audio src={staticFile('music.wav')} />
    </AbsoluteFill>
  );
};
