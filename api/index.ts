import app from "../server.ts";

export default async (req: any, res: any) => {
  const server = await app;
  return server(req, res);
};
