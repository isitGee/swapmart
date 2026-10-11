import type {
  InputHTMLAttributes,
  ReactNode,
  Ref,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { cn } from '@/lib/cn';
import { Icon } from './icon';

interface FieldProps {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  children: ReactNode;
  className?: string;
  /** Renders the label inline with hint/error text, used in dense filter panels. */
  compact?: boolean;
}

/**
 * Labelled form control. The error text is wired to the control through
 * `aria-describedby` by the callers that need it; this component guarantees the
 * message is always visible next to the field rather than only in a summary.
 */
export function Field({ label, htmlFor, hint, error, required, children, className, compact }: FieldProps) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className={cn('flex items-baseline justify-between gap-3', compact && 'flex-row')}>
        <label htmlFor={htmlFor} className="text-[0.8125rem] font-medium text-ink-700">
          {label}
          {required ? <span className="ml-0.5 text-danger-600">*</span> : null}
        </label>
        {hint && !error ? <span className="text-xs text-ink-500">{hint}</span> : null}
      </div>
      {children}
      {error ? (
        <p role="alert" className="flex items-start gap-1.5 text-xs font-medium text-danger-600">
          <Icon name="alert" size={13} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  icon?: ReactNode;
}

export function Input({ className, invalid, icon, ref, ...rest }: InputProps & { ref?: Ref<HTMLInputElement> }) {
  if (icon) {
    return (
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400">{icon}</span>
        <input ref={ref} className={cn('sm-input pl-9', className)} aria-invalid={invalid || undefined} {...rest} />
      </div>
    );
  }
  return <input ref={ref} className={cn('sm-input', className)} aria-invalid={invalid || undefined} {...rest} />;
}

export function Textarea({
  className,
  invalid,
  ref,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean; ref?: Ref<HTMLTextAreaElement> }) {
  return (
    <textarea ref={ref} className={cn('sm-input min-h-24 resize-y', className)} aria-invalid={invalid || undefined} {...rest} />
  );
}

export function Select({ className, invalid, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  return (
    <select className={cn('sm-input appearance-none bg-no-repeat pr-9', className)} aria-invalid={invalid || undefined} {...rest}>
      {children}
    </select>
  );
}

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode;
  description?: string;
}

export function Checkbox({ label, description, className, id, ...rest }: CheckboxProps) {
  return (
    <div className={cn('flex items-start gap-2.5', className)}>
      <input
        id={id}
        type="checkbox"
        className="mt-0.5 h-4 w-4 shrink-0 rounded border-line-strong text-brand-600 accent-brand-600"
        {...rest}
      />
      <label htmlFor={id} className="text-sm text-ink-700">
        {label}
        {description ? <span className="mt-0.5 block text-xs text-ink-500">{description}</span> : null}
      </label>
    </div>
  );
}

interface RadioGroupProps {
  name: string;
  legend: string;
  value: string;
  onChange?: (value: string) => void;
  options: { value: string; label: string; description?: string }[];
  columns?: 1 | 2 | 3;
}

/** Card-style radio group used for condition, evidence kind and reason codes. */
export function RadioGroup({ name, legend, value, onChange, options, columns = 2 }: RadioGroupProps) {
  const grid = columns === 1 ? 'grid-cols-1' : columns === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-3';
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-[0.8125rem] font-medium text-ink-700">{legend}</legend>
      <div className={cn('grid gap-2', grid)}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <label
              key={option.value}
              className={cn(
                'flex cursor-pointer items-start gap-2.5 rounded-control border p-2.5 transition-colors',
                selected ? 'border-brand-500 bg-brand-50' : 'border-line bg-surface hover:border-line-strong hover:bg-surface-muted',
              )}
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={selected}
                onChange={() => onChange?.(option.value)}
                className="mt-0.5 h-4 w-4 accent-brand-600"
              />
              <span>
                <span className="block text-sm font-medium text-ink-800">{option.label}</span>
                {option.description ? <span className="mt-0.5 block text-xs text-ink-500">{option.description}</span> : null}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
