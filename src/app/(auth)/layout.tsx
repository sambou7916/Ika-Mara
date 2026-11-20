export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // L'habillage (fond, logo, titre) est fourni par <LoginShell> dans chaque page.
  return <>{children}</>;
}
