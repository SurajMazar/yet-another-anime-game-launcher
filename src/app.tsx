import {
  exec,
  log,
  spawn,
  timeout,
  resolve,
  appendFile,
  addTerminationHook,
  GLOBAL_onClose,
  setKey,
} from "./utils";
import { createAria2 } from "./aria2";
import { checkWine, createWine, createWineInstallProgram } from "./wine";
import { createGithubEndpoint } from "./github";
import { createLauncher } from "./launcher";
import "./app.css";
import { createUpdater, downloadProgram } from "./updater";
import { createCommonUpdateUI } from "./common-update-ui";
import { createLocale } from "./locale";
import { CROSSOVER_LOADER } from "./crossover";
import { BH3_GLB, CN_SERVER, OS_SERVER } from "./constants";
import { rawString } from "./command-builder";
import { createHK4EChannelClient } from "./launcher/hk4e";
import { ChannelClient } from "./launcher/channel-client";
import { createBH3ChannelClient } from "./launcher/bh3";

export async function createApp() {
  await setKey("singleton", null);

  const aria2_port = 6868;

  await Neutralino.events.on("windowClose", async () => {
    if (await GLOBAL_onClose(false)) {
      Neutralino.app.exit(0);
    }
  });

  const locale = await createLocale();
  const github = await createGithubEndpoint();
  const aria2_session = await resolve("./aria2.session");
  await appendFile(aria2_session, "");
  const pid = (await exec(["echo", rawString("$PPID")])).stdOut.split("\n")[0];
  const { pid: apid } = await spawn([
    "./sidecar/aria2/aria2c",
    "-d",
    "/",
    "--no-conf",
    "--enable-rpc",
    `--rpc-listen-port=${aria2_port}`,
    `--rpc-listen-all=true`,
    `--rpc-allow-origin-all`,
    `--input-file`,
    `${aria2_session}`,
    `--save-session`,
    `${aria2_session}`,
    `--pause`,
    `true`,
    "--stop-with-process",
    pid,
  ]);
  addTerminationHook(async () => {
    // double insurance (esp. for self restart)
    await log("killing process " + apid);
    try {
      await exec(["kill", apid + ""]);
    } catch {
      await log("killing process failed?");
    }
    return true;
  });
  const aria2 = await Promise.race([
    createAria2({ host: "127.0.0.1", port: aria2_port }),
    timeout(10000),
  ]).catch(() => Promise.reject(new Error("Fail to launch aria2.")));
  await log(`Launched aria2 version ${aria2.version.version}`);

  const { latest, downloadUrl, description, version } = await createUpdater({
    github,
    aria2,
  });
  if (latest == false) {
    if (
      await locale.prompt(
        "NEW_VERSION_AVALIABLE",
        "NEW_VERSION_AVALIABLE_DESC",
        [version, description]
      )
    ) {
      return createCommonUpdateUI(locale, () =>
        downloadProgram(aria2, downloadUrl)
      );
    }
  }

  const { wineReady, wineUpdate, wineUpdateTag, wineTag } = await checkWine(
    github
  );
  const prefixPath = await resolve("./wineprefix"); // CHECK: hardcoded path?

  if (wineReady) {
    const wine = await createWine({
      loaderBin:
        wineTag == "crossover"
          ? CROSSOVER_LOADER
          : await resolve("./wine/bin/wine64"), // CHECK: hardcoded path?
      prefix: prefixPath,
    });
    let channelClient: ChannelClient;
    if (import.meta.env["YAAGL_CHANNEL_CLIENT"] == "hk4eos") {
      channelClient = await createHK4EChannelClient({
        server: OS_SERVER,
        locale,
        aria2,
        wine,
      });
    } else if (import.meta.env["YAAGL_CHANNEL_CLIENT"] == "bh3glb") {
      channelClient = await createBH3ChannelClient({
        server: BH3_GLB,
        locale,
        aria2,
        wine,
      });
    } else {
      channelClient = await createHK4EChannelClient({
        server: CN_SERVER,
        locale,
        aria2,
        wine,
      });
    }
    return await createLauncher({
      wine,
      locale,
      github,
      channelClient,
    });
  } else {
    return await createWineInstallProgram({
      aria2,
      wineUpdateTarGzFile: wineUpdate,
      wineAbsPrefix: prefixPath,
      wineTag: wineUpdateTag,
      locale,
    });
  }
}
