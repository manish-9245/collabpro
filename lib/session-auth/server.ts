import { cookies } from "next/headers";
import { verifyToken } from "./jwt";

export function getServerSession() {
  return {
    isAuthenticated: async () => {
      const cookieStore = await cookies();
      const session = cookieStore.get("session_token")?.value;
      if (!session) return false;
      return verifyToken(session) !== null;
    },
    getUser: async () => {
      const cookieStore = await cookies();
      const session = cookieStore.get("session_token")?.value;
      if (!session) return null;
      try {
        const user = verifyToken(session);
        if (!user) return null;
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
