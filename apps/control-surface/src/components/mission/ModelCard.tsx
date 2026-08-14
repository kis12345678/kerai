import { Icon } from '../icons';

export interface ModelCardProps {
  name: string;
  selected: boolean;
  onSelect: (name: string) => void;
}

export function ModelCard({ name, selected, onSelect }: ModelCardProps) {
  return (
    <button
      type="button"
      className={`model-card ${selected ? 'model-card--selected' : ''}`}
      onClick={() => onSelect(name)}
      aria-pressed={selected}
    >
      <span className="model-card__name">{name}</span>
      {selected ? <Icon name="check" size={15} /> : null}
    </button>
  );
}
