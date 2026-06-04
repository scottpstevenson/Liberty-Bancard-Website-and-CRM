import type { Express } from "express";

const WIDGET_JS = `
(function () {
  "use strict";

  function initWidget(scriptEl) {
    var ref = scriptEl.getAttribute("data-ref") || "";
    var theme = scriptEl.getAttribute("data-theme") || "light";
    var containerId = scriptEl.getAttribute("data-container") || "lb-widget";
    var container = document.getElementById(containerId);
    if (!container) {
      container = document.createElement("div");
      scriptEl.parentNode.insertBefore(container, scriptEl);
    }

    var isDark = theme === "dark";

    var styles = {
      bg: isDark ? "#1a1a2e" : "#ffffff",
      border: isDark ? "#334155" : "#e2e8f0",
      text: isDark ? "#f1f5f9" : "#0f172a",
      muted: isDark ? "#94a3b8" : "#64748b",
      primary: "#1d4ed8",
      primaryText: "#ffffff",
      inputBg: isDark ? "#0f172a" : "#f8fafc",
      inputBorder: isDark ? "#475569" : "#cbd5e1",
      resultBg: isDark ? "#0f172a" : "#f0f9ff",
      resultBorder: isDark ? "#1e40af" : "#bfdbfe",
      savingsColor: isDark ? "#34d399" : "#059669",
      noteColor: isDark ? "#fbbf24" : "#d97706",
    };

    var html = [
      '<div id="lb-sc-root" style="',
      "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;",
      "background:" + styles.bg + ";",
      "border:1px solid " + styles.border + ";",
      "border-radius:12px;",
      "padding:24px;",
      "max-width:560px;",
      "width:100%;",
      "box-sizing:border-box;",
      "color:" + styles.text + ";",
      '">',

      '<div style="margin-bottom:20px;">',
      '<div style="font-size:18px;font-weight:700;line-height:1.3;margin-bottom:6px;color:' + styles.text + ';">',
      "How Much Could You Save on Processing?",
      "</div>",
      '<div style="font-size:13px;color:' + styles.muted + ';">',
      "Enter your monthly volume and current rate to see your potential savings.",
      "</div>",
      "</div>",

      '<div style="display:flex;flex-direction:column;gap:14px;margin-bottom:18px;">',

      '<div>',
      '<label style="display:block;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:' + styles.muted + ';margin-bottom:6px;">Monthly Processing Volume ($)</label>',
      '<input id="lb-sc-volume" type="number" min="0" step="1000" placeholder="e.g. 50000" style="',
      "width:100%;box-sizing:border-box;padding:10px 14px;border:1px solid " + styles.inputBorder + ";",
      "border-radius:8px;font-size:15px;background:" + styles.inputBg + ";color:" + styles.text + ";",
      'outline:none;" />',
      "</div>",

      '<div>',
      '<label style="display:block;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:' + styles.muted + ';margin-bottom:6px;">Current Effective Rate (%)</label>',
      '<input id="lb-sc-rate" type="number" min="0" max="10" step="0.01" placeholder="e.g. 2.9" style="',
      "width:100%;box-sizing:border-box;padding:10px 14px;border:1px solid " + styles.inputBorder + ";",
      "border-radius:8px;font-size:15px;background:" + styles.inputBg + ";color:" + styles.text + ";",
      'outline:none;" />',
      "</div>",

      "</div>",

      '<button id="lb-sc-btn" style="',
      "width:100%;padding:12px 20px;",
      "background:" + styles.primary + ";color:" + styles.primaryText + ";",
      "border:none;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer;",
      'transition:opacity 0.15s;">',
      "Calculate My Savings",
      "</button>",

      '<div id="lb-sc-result" style="display:none;margin-top:18px;"></div>',

      '<div style="margin-top:16px;font-size:10px;color:' + styles.muted + ';text-align:center;">',
      "Powered by <a href='https://libertybancard.com' target='_blank' rel='noopener' style='color:" + styles.primary + ";text-decoration:none;font-weight:600;'>Liberty Bancard</a>",
      "</div>",

      "</div>",
    ].join("");

    container.innerHTML = html;

    var btn = document.getElementById("lb-sc-btn");
    var resultEl = document.getElementById("lb-sc-result");
    var volumeEl = document.getElementById("lb-sc-volume");
    var rateEl = document.getElementById("lb-sc-rate");

    btn.addEventListener("mouseenter", function () { btn.style.opacity = "0.85"; });
    btn.addEventListener("mouseleave", function () { btn.style.opacity = "1"; });

    btn.addEventListener("click", function () {
      var volume = parseFloat(volumeEl.value);
      var rate = parseFloat(rateEl.value);

      if (!volume || volume <= 0 || isNaN(volume)) {
        volumeEl.style.borderColor = "#ef4444";
        volumeEl.focus();
        return;
      } else {
        volumeEl.style.borderColor = styles.inputBorder;
      }

      if (isNaN(rate) || rate < 0) {
        rateEl.style.borderColor = "#ef4444";
        rateEl.focus();
        return;
      } else {
        rateEl.style.borderColor = styles.inputBorder;
      }

      var LIBERTY_RATE = 0.0185;
      var savings = volume * Math.max(0, rate / 100 - LIBERTY_RATE);
      var annualSavings = savings * 12;

      var scriptSrc = (scriptEl && scriptEl.src) ? scriptEl.src : "";
      var widgetOrigin = "";
      try {
        widgetOrigin = scriptSrc ? new URL(scriptSrc).origin : window.location.origin;
      } catch (e) {
        widgetOrigin = window.location.origin;
      }
      var ctaBase = widgetOrigin + "/upload-statement?utm_source=partner-widget&utm_medium=embed&utm_campaign=" + (ref || "partner");
      if (ref) ctaBase += "&ref=" + encodeURIComponent(ref);

      var resultHtml;

      if (rate / 100 <= LIBERTY_RATE) {
        resultHtml = [
          '<div style="background:' + styles.resultBg + ';border:1px solid ' + styles.resultBorder + ';border-radius:10px;padding:18px;">',
          '<div style="font-size:13px;font-weight:600;color:' + styles.noteColor + ';margin-bottom:6px;">&#9888; You may already be on a competitive rate</div>',
          '<div style="font-size:13px;color:' + styles.muted + ';margin-bottom:14px;">Your current rate of ' + rate + '% is at or below Liberty\'s illustrative 1.85% interchange-plus benchmark. A free statement review can confirm if you\'re getting the best deal.</div>',
          '<a href="' + ctaBase + '" target="_blank" rel="noopener" style="',
          "display:block;text-align:center;padding:11px 18px;",
          "background:" + styles.primary + ";color:" + styles.primaryText + ";",
          "border-radius:8px;font-size:14px;font-weight:600;text-decoration:none;",
          '">Get My Free Analysis</a>',
          "</div>",
        ].join("");
      } else {
        var fmtMonthly = "$" + savings.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
        var fmtAnnual = "$" + annualSavings.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
        resultHtml = [
          '<div style="background:' + styles.resultBg + ';border:1px solid ' + styles.resultBorder + ';border-radius:10px;padding:18px;">',
          '<div style="display:flex;gap:12px;margin-bottom:14px;flex-wrap:wrap;">',

          '<div style="flex:1;min-width:130px;text-align:center;background:' + styles.bg + ';border:1px solid ' + styles.border + ';border-radius:8px;padding:14px 10px;">',
          '<div style="font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:' + styles.muted + ';margin-bottom:4px;">Monthly Savings</div>',
          '<div style="font-size:26px;font-weight:700;color:' + styles.savingsColor + ';">' + fmtMonthly + '</div>',
          '</div>',

          '<div style="flex:1;min-width:130px;text-align:center;background:' + styles.bg + ';border:1px solid ' + styles.border + ';border-radius:8px;padding:14px 10px;">',
          '<div style="font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:' + styles.muted + ';margin-bottom:4px;">Annual Savings</div>',
          '<div style="font-size:26px;font-weight:700;color:' + styles.savingsColor + ';">' + fmtAnnual + '</div>',
          '</div>',

          '</div>',
          '<div style="font-size:12px;color:' + styles.muted + ';margin-bottom:14px;">',
          'Based on switching from ' + rate + '% to Liberty\'s 1.85% illustrative interchange-plus effective rate.',
          '</div>',
          '<a href="' + ctaBase + '" target="_blank" rel="noopener" style="',
          "display:block;text-align:center;padding:11px 18px;",
          "background:" + styles.primary + ";color:" + styles.primaryText + ";",
          "border-radius:8px;font-size:14px;font-weight:600;text-decoration:none;",
          '">Get My Free Analysis &#8594;</a>',
          "</div>",
        ].join("");
      }

      resultEl.innerHTML = resultHtml;
      resultEl.style.display = "block";
    });
  }

  function findThisScript() {
    var scripts = document.querySelectorAll("script[src*='savings-calculator.js']");
    return scripts[scripts.length - 1] || null;
  }

  var currentScript = document.currentScript || findThisScript();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      initWidget(currentScript);
    });
  } else {
    initWidget(currentScript);
  }
})();
`;

export function registerWidgetRoutes(app: Express) {
  app.get("/widget/savings-calculator.js", (req, res) => {
    res.setHeader("Content-Type", "application/javascript; charset=utf-8");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.send(WIDGET_JS);
  });

  app.get("/widget/preview", (req, res) => {
    const ref = String(req.query.ref || "");
    const theme = req.query.theme === "dark" ? "dark" : "light";
    const bg = theme === "dark" ? "#111827" : "#f8fafc";
    const protocol = req.headers["x-forwarded-proto"] || req.protocol;
    const host = req.headers["x-forwarded-host"] || req.headers.host || (process.env.APP_URL ? new URL(process.env.APP_URL).host : "localhost:5000");
    const origin = `${protocol}://${host}`;

    const safeRef = ref.replace(/[^a-zA-Z0-9_\-]/g, "").slice(0, 64);
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: ${bg}; padding: 16px; display: flex; justify-content: center; }
</style>
</head>
<body>
<div id="lb-widget"></div>
<script src="${origin}/widget/savings-calculator.js" data-ref="${safeRef}" data-theme="${theme}"></script>
</body>
</html>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "no-store");
    res.send(html);
  });
}
