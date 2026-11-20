import { redirect } from "next/navigation";

/**
 * Page racine — redirige vers /agent (login si non authentifié).
 */
export default function Home() {
  redirect("/agent");
}
