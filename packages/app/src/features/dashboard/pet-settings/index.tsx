import type { CSSProperties } from 'react';
import {
  DEFAULT_PET_SIZE,
  MAX_PET_SIZE,
  MIN_PET_SIZE,
  usePetPreferences,
} from '../../../shared/preferences/pet.js';
import petImage from '../../../../../../docs/prototype/assets/rover-pet.png';

export function PetSettingsView() {
  const { size: petSize, status, error, setSize } = usePetPreferences();
  const setPetSize = (size: number) => {
    // The store exposes write failures through the snapshot rendered below.
    void setSize(size).catch(() => {});
  };
  return (
    <section
      className="max-w-2xl rounded-[27px] border border-white bg-white/95 p-6 text-[#263246] shadow-[0_7px_20px_#1f344b17]"
      aria-labelledby="pet-settings-title"
      style={{ '--pet-scale': petSize / 100 } as CSSProperties}
    >
      <h2 id="pet-settings-title" className="text-lg font-semibold">
        宠物设置
      </h2>
      <p className="mt-2 text-xs leading-relaxed text-[#686f7c]">
        调整宠物、快捷按钮、输入栏和任务卡片的整体尺寸。
      </p>
      <div className="mt-6 flex items-center gap-6 rounded-2xl bg-[#f3f7fd] p-5">
        <div className="flex h-[120px] w-[120px] shrink-0 items-center justify-center">
          <img
            src={petImage}
            alt="宠物尺寸预览"
            className="h-[calc(94px*var(--pet-scale))] w-auto object-contain drop-shadow-[0_8px_7px_#263b5470]"
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-3 flex items-center justify-between gap-3">
            <label htmlFor="pet-size" className="text-sm font-semibold">
              显示尺寸
            </label>
            <output
              htmlFor="pet-size"
              className="rounded-full bg-[#eaf1ff] px-3 py-1 text-xs font-semibold text-[#386bb9]"
            >
              {petSize}%
            </output>
          </div>
          <input
            id="pet-size"
            type="range"
            min={MIN_PET_SIZE}
            max={MAX_PET_SIZE}
            step={5}
            value={petSize}
            disabled={status === 'loading'}
            onChange={(event) => setPetSize(Number(event.target.value))}
            className="w-full cursor-pointer accent-[#3479ed]"
          />
          <div className="mt-2 flex justify-between text-[11px] text-[#657993]">
            <span>更小 · {MIN_PET_SIZE}%</span>
            <span>更大 · {MAX_PET_SIZE}%</span>
          </div>
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between gap-3">
        <p role={error ? 'alert' : 'status'} className="text-xs text-[#657993]">
          {error
            ? '设置读取或保存失败，请重试。'
            : status === 'loading'
              ? '正在读取设置…'
              : '自动保存，立即应用到宠物窗口。'}
        </p>
        <button
          type="button"
          disabled={status === 'loading'}
          onClick={() => setPetSize(DEFAULT_PET_SIZE)}
          className="cursor-pointer rounded-full bg-[#edf3ff] px-4 py-2 text-xs font-semibold text-[#3266ba] hover:bg-[#dfebff] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8bb8ff]"
        >
          恢复默认 · {DEFAULT_PET_SIZE}%
        </button>
      </div>
    </section>
  );
}
