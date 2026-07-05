import { cookies } from "next/headers";

export function getKindeServerSession() {
  return {
    isAuthenticated: async () => {
      const cookieStore = cookies();
      const session = cookieStore.get("session_token")?.value;
      return !!session;
    },
    getUser: async () => {
      const cookieStore = cookies();
      const session = cookieStore.get("session_token")?.value;
      if (!session) return null;
      try {
        const user = JSON.parse(session);
        return {
          id: user.id,
          email: user.email,
          given_name: user.name,
          picture: user.image,
        };
      } catch {
        return null;
      }
    }
  };
}
