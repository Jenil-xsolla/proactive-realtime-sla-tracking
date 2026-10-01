import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";

const control =
  "w-full rounded border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring read-only:bg-muted";

export function TextInput({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${control} ${className}`} {...props} />;
}

export function TextArea({ className = "", ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${control} ${className}`} {...props} />;
}

export function Field({
  label,
  htmlFor,
  field,
  error,
  warning,
  children,
}: {
  label: string;
  htmlFor: string;
  field: string;
  error?: string;
  warning?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2" data-field={field}>
      <label htmlFor={htmlFor} className="text-sm font-medium text-foreground">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} className="text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
      {!error && warning ? (
        <p id={`${htmlFor}-warning`} className="text-sm text-warning">
          {warning}
        </p>
      ) : null}
    </div>
  );
}
