interface NumberFieldProps {
  value: number
  min?: number
  label: string
  disabled?: boolean
  onChange: (value: number) => void
}

export function NumberField({ value, min = 0, label, disabled = false, onChange }: NumberFieldProps) {
  const update = (next: number) => onChange(Math.max(min, Math.round(next || 0)))

  return (
    <div className={`number-field${disabled ? ' disabled' : ''}`}>
      <button disabled={disabled} type="button" aria-label={`${label}减少`} onClick={() => update(value - 1)}>
        −
      </button>
      <input
        aria-label={label}
        inputMode="numeric"
        min={min}
        disabled={disabled}
        type="number"
        value={value}
        onChange={(event) => update(Number(event.target.value))}
      />
      <button disabled={disabled} type="button" aria-label={`${label}增加`} onClick={() => update(value + 1)}>
        +
      </button>
    </div>
  )
}
