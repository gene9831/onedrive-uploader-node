import dotenv from "dotenv";
import assert from "node:assert";
import path from "node:path";

export const getEnvVars = () => {
  dotenv.config({ path: path.join(path.dirname(__dirname), ".env") });

  const { TENANT_ID, CLIENT_ID, CLIENT_SECRET, USER_ID } = process.env;

  assert(TENANT_ID, "TENANT_ID is required");
  assert(CLIENT_ID, "CLIENT_ID is required");
  assert(CLIENT_SECRET, "CLIENT_SECRET is required");
  assert(USER_ID, "USER_ID is required");

  return {
    TENANT_ID,
    CLIENT_ID,
    CLIENT_SECRET,
    USER_ID,
  };
};
