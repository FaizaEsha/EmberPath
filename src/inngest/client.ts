import { Inngest } from "inngest";
export const inngest = new Inngest({
  id: "emberpath",
  isDev: process.env.INNGEST_DEV === "1",
});
