import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import type { AddressInfo, Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:tls";
import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";

export const SFP_TEST_COLD_DOMAIN = "liberty-outreach.test";
export const SFP_TEST_COLD_FROM = `Scott@${SFP_TEST_COLD_DOMAIN}`;

/** Send the dedicated profile to a private TLS socket with a per-test certificate. */
export async function startSfpColdSmtpFixture(smtp: Server) {
  const directory = mkdtempSync(join(tmpdir(), "sfp-smtp-tls-"));
  const keyPath = join(directory, "key.pem");
  const certPath = join(directory, "cert.pem");
  let tlsServer;
  try {
    execFileSync("openssl", [
      "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
      "-subj", "/CN=localhost", "-keyout", keyPath, "-out", certPath,
    ], { stdio: "ignore" });
    const cert = readFileSync(certPath);
    tlsServer = createServer({ key: readFileSync(keyPath), cert }, (socket) => smtp.emit("connection", socket));
    await new Promise<void>((resolve, reject) => {
      tlsServer.once("error", reject);
      tlsServer.listen(0, "127.0.0.1", resolve);
    });
    const coldHost = "smtp.cold.example.test";
    const coldUser = SFP_TEST_COLD_FROM;
    const coldPass = "disposable-cold-password";
    process.env.SFP_COLD_SMTP_HOST = coldHost;
    process.env.SFP_COLD_SMTP_PORT = "465";
    process.env.SFP_COLD_SMTP_USER = coldUser;
    process.env.SFP_COLD_SMTP_PASS = coldPass;

    const createTransport = nodemailer.createTransport;
    let dedicatedConnections = 0;
    // The production port is preserved up to the adapter boundary. Only the
    // fixture hostname gets remapped to the randomized local test port.
    nodemailer.createTransport = ((options: SMTPTransport.Options | string, defaults?: SMTPTransport.Options) => {
      if (typeof options === "string" || options.host !== coldHost) return createTransport(options, defaults);
      if (!options.secure || options.port !== 465 || options.auth?.user !== coldUser || options.auth?.pass !== coldPass) {
        throw new Error("Dedicated SMTP transport did not use the expected TLS mailbox settings");
      }
      dedicatedConnections++;
      return createTransport({
        ...options, host: "127.0.0.1", port: (tlsServer.address() as AddressInfo).port,
        tls: { ca: cert, servername: "localhost" },
      }, defaults);
    }) as typeof nodemailer.createTransport;

    return {
      dedicatedConnections: () => dedicatedConnections,
      close() {
        nodemailer.createTransport = createTransport;
        tlsServer.close();
      },
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
