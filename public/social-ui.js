(() => {
  const platforms = {
    facebook: {
      name: "Facebook",
      color: "#1877f2",
      svg: `
        <path
          fill="currentColor"
          d="M14 21v-8h3l.5-4H14V7c0-1 .3-2 2-2h2V1.5A25 25 0 0 0 15 1c-3 0-5 2-5 5v3H7v4h3v8z"
        />
      `,
    },

    instagram: {
      name: "Instagram",
      color: "#c13584",
      svg: `
        <rect
          x="3" y="3" width="18" height="18" rx="5"
          fill="none" stroke="currentColor" stroke-width="2"
        />
        <circle
          cx="12" cy="12" r="4"
          fill="none" stroke="currentColor" stroke-width="2"
        />
        <circle
          cx="17.5" cy="6.5" r="1.2"
          fill="currentColor"
        />
      `,
    },

    twitter: {
      name: "X",
      color: "#161616",
      svg: `
        <path
          fill="currentColor"
          d="M18.9 2H22l-6.8 7.8L23.2 22h-6.3L12 14.6 5.5 22H2.3l7.8-9L.8 2h6.5l4.5 6.7L18.9 2ZM17.9 20h1.7L6.2 4H4.4z"
        />
      `,
    },

    linkedin: {
      name: "LinkedIn",
      color: "#0a66c2",
      text: "in",
    },

    youtube: {
      name: "YouTube",
      color: "#e11d24",
      svg: `
        <rect
          x="2" y="5" width="20" height="14" rx="4"
          fill="currentColor"
        />
        <path d="m10 9 6 3-6 3z" fill="white"/>
      `,
    },

    tiktok: {
      name: "TikTok",
      color: "#151515",
      text: "♪",
    },

    threads: {
      name: "Threads",
      color: "#252525",
      text: "@",
    },

    bluesky: {
      name: "Bluesky",
      color: "#1684fd",
      text: "B",
    },

    pinterest: {
      name: "Pinterest",
      color: "#bd081c",
      text: "P",
    },

    mastodon: {
      name: "Mastodon",
      color: "#6364ff",
      text: "M",
    },

    googlebusiness: {
      name: "Google Business",
      color: "#4285f4",
      text: "G",
    },
  };

  function platform(service) {
    let key = String(service || "")
      .toLowerCase()
      .replace(/[ _-]/g, "");

    if (key === "x") key = "twitter";
    if (key === "google") key = "googlebusiness";

    return platforms[key] || {
      name: service || "Social channel",
      color: "#685a50",
      text: "↗",
    };
  }

  function icon(service) {
    const info = platform(service);
    const badge = document.createElement("span");

    badge.className = "social-icon";
    badge.style.setProperty("--platform-color", info.color);
    badge.setAttribute("aria-hidden", "true");

    if (info.svg) {
      badge.innerHTML = `
        <svg
          viewBox="0 0 24 24"
          focusable="false"
          aria-hidden="true"
        >
          ${info.svg}
        </svg>
      `;
    } else {
      badge.textContent = info.text;
    }

    return badge;
  }

  function account(channel, detail) {
    const row = document.createElement("span");
    row.className = "social-account";

    const copy = document.createElement("span");
    copy.className = "social-account-copy";

    const name = document.createElement("strong");
    name.textContent =
      channel.displayName ||
      channel.name ||
      platform(channel.service).name;

    const sub = document.createElement("small");
    sub.textContent = [
      platform(channel.service).name,
      detail,
    ]
      .filter(Boolean)
      .join(" · ");

    copy.append(name, sub);
    row.append(icon(channel.service), copy);

    return row;
  }

  window.SlotBackSocial = {
    icon,
    account,
    platform,
  };

  document.addEventListener("DOMContentLoaded", () => {
    const select = document.querySelector("#channel");

    if (!select) return;

    const picker = document.createElement("details");
    picker.className = "social-picker";

    const trigger = document.createElement("summary");
    trigger.id = "channel-picker-trigger";

    const value = document.createElement("span");
    value.id = "channel-picker-value";

    const arrow = document.createElement("span");
    arrow.className = "social-picker-arrow";
    arrow.textContent = "⌄";
    arrow.setAttribute("aria-hidden", "true");

    trigger.append(value, arrow);

    const menu = document.createElement("div");
    menu.className = "social-picker-menu";

    picker.append(trigger, menu);

    const label = document.querySelector(
      'label[for="channel"]'
    );

    if (label) {
      label.id = "channel-picker-label";
      label.removeAttribute("for");

      trigger.setAttribute(
        "aria-labelledby",
        `${label.id} ${value.id}`
      );

      label.addEventListener("click", () => {
        if (!select.disabled) trigger.focus();
      });
    }

    // Keep the existing select as the source of truth.
    // Existing channel-selection and booking logic still uses it.
    select.hidden = true;
    select.after(picker);

    function optionContent(option) {
      const channels =
        typeof availableChannels === "undefined"
          ? []
          : availableChannels;

      if (option.value === "all") {
        const row = document.createElement("span");
        row.className = "social-account";

        const stack = document.createElement("span");
        stack.className = "social-icon-stack";

        const services = [
          ...new Set(channels.map(channel => channel.service)),
        ].slice(0, 3);

        for (const service of services) {
          stack.append(icon(service));
        }

        const text = document.createElement("strong");
        text.textContent = option.textContent;

        row.append(stack, text);

        return row;
      }

      const channel = channels.find(
        item => item.id === option.value
      );

      if (channel) return account(channel);

      const text = document.createElement("span");
      text.textContent =
        option.textContent || "Choose where to share";

      return text;
    }

    function sync() {
      trigger.setAttribute(
        "aria-disabled",
        String(select.disabled)
      );

      trigger.tabIndex = select.disabled ? -1 : 0;
      picker.classList.toggle("is-disabled", select.disabled);

      if (select.disabled) picker.open = false;

      const selected = select.selectedOptions[0];

      if (selected) {
        value.replaceChildren(optionContent(selected));
      } else {
        value.textContent = select.disabled
          ? "No channels available"
          : "Choose where to share";
      }

      menu.replaceChildren();

      for (const option of select.options) {
        if (!option.value) continue;

        const button = document.createElement("button");
        button.type = "button";
        button.className = "social-picker-option";
        button.disabled = select.disabled || option.disabled;

        button.setAttribute(
          "aria-pressed",
          String(option.selected)
        );

        const check = document.createElement("span");
        check.className = "social-picker-check";
        check.textContent = option.selected ? "✓" : "";
        check.setAttribute("aria-hidden", "true");

        button.append(optionContent(option), check);

        button.onclick = () => {
          if (select.disabled) return;

          select.value = option.value;

          select.dispatchEvent(
            new Event("change", { bubbles: true })
          );

          picker.open = false;
          sync();
          trigger.focus();
        };

        menu.append(button);
      }
    }

    trigger.addEventListener("click", event => {
      if (select.disabled) event.preventDefault();
    });

    picker.addEventListener("keydown", event => {
      if (event.key === "Escape") {
        picker.open = false;
        trigger.focus();
      }
    });

    document.addEventListener("click", event => {
      if (!picker.contains(event.target)) {
        picker.open = false;
      }
    });

    select.addEventListener("change", sync);

    new MutationObserver(sync).observe(select, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });

    sync();
  });
})();
