export function focusFirstInvalidField(form: HTMLFormElement) {
  requestAnimationFrame(() => {
    form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  });
}
