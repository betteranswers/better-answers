import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { emailOTPClient, organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/client";

export const authClient = createAuthClient({
  basePath: "/",
  plugins: [emailOTPClient(), organizationClient(), oauthProviderClient()],
});
