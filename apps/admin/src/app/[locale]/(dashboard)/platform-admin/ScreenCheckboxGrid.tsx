import { ALL_SCREENS } from '@/lib/platformPlans';

interface Props {
  screens: string[];
  onChange: (screens: string[]) => void;
}

export function ScreenCheckboxGrid({ screens, onChange }: Props) {
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-2">
      {ALL_SCREENS.map((s) => (
        <label key={s.slug} className="flex items-center gap-2 cursor-pointer py-0.5">
          <input
            type="checkbox"
            checked={screens.includes(s.slug)}
            onChange={() =>
              onChange(
                screens.includes(s.slug)
                  ? screens.filter((x) => x !== s.slug)
                  : [...screens, s.slug]
              )
            }
            className="w-4 h-4 rounded shrink-0"
          />
          <span className="text-sm">{s.label}</span>
        </label>
      ))}
    </div>
  );
}
