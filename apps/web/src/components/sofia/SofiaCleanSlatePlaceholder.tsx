type SofiaCleanSlatePlaceholderProps = {
  title: string;
  description: string;
  testId: string;
};

// Deliberately neutral boundary while the next SOFIA/CRM interface is designed.
export function SofiaCleanSlatePlaceholder({ title, description, testId }: SofiaCleanSlatePlaceholderProps) {
  return (
    <section data-testid={testId}>
      <h1>{title}</h1>
      <p>{description}</p>
    </section>
  );
}
