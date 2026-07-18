import { ChevronUp, ChevronDown } from 'lucide-react';

// Sortable column header, shared by the lg+ tables of Foods and Recipes.
export default function SortTh({ label, sortKey: key, active, dir, onSort, align }) {
  const isActive = active === key;
  return (
    <th
      aria-sort={isActive ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={`px-3 py-2 font-medium cursor-pointer select-none ${align === 'right' ? 'text-right' : ''}`}
      onClick={() => onSort(key)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {isActive && (dir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
      </span>
    </th>
  );
}
