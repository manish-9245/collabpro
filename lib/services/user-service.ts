import { prisma as defaultPrisma } from "@/lib/db";

export interface IDbClient {
  findUnique(args: { where: { id: string } | { email: string } }): Promise<any>;
}

export class UserRepository {
  private db: IDbClient;

  constructor(db: IDbClient = defaultPrisma.user as any) {
    this.db = db;
  }

  async findUserById(id: string) {
    return this.db.findUnique({
      where: { id },
    });
  }

  async findUserByEmail(email: string) {
    return this.db.findUnique({
      where: { email },
    });
  }
}

export class UserService {
  private userRepo: UserRepository;

  constructor(userRepo: UserRepository) {
    this.userRepo = userRepo;
  }

  async getUserById(id: string) {
    return this.userRepo.findUserById(id);
  }

  async getUserByEmail(email: string) {
    return this.userRepo.findUserByEmail(email);
  }
}
