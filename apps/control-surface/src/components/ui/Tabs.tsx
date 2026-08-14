export interface TabItem {
  id: string;
  label: React.ReactNode;
}

export interface TabsProps {
  items: TabItem[];
  selected: string;
  onSelect: (id: string) => void;
  ariaLabel: string;
}

export function Tabs({ items, selected, onSelect, ariaLabel }: TabsProps) {
  return (
    <div className="tabs" role="tablist" aria-label={ariaLabel}>
      {items.map(item => (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={selected === item.id}
          className="tabs__tab"
          onClick={() => onSelect(item.id)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
