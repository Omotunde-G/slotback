const workspaceSelect = document.querySelector("#workspace");
const channelSelect = document.querySelector("#channel");
const statusMessage = document.querySelector("#connection-status");
const selectionMessage = document.querySelector("#channel-selection");
const connectedAccount = document.querySelector("#connected-account");
const reconnectBuffer = document.querySelector("#reconnect-buffer");

const openingForm = document.querySelector("#opening-form");
const openingMessage = document.querySelector("#opening-message");
const openingPreview = document.querySelector("#opening-preview");
const previewContent = document.querySelector("#preview-content");
const saveOpeningButton = document.querySelector("#save-opening");
const saveMessage = document.querySelector("#save-message");
const savedOpeningLink = document.querySelector("#saved-opening-link");

const downloadFlyer = document.querySelector("#download-flyer");
const saveFlyerButton = document.querySelector("#save-flyer");
const flyerUploadMessage = document.querySelector("#flyer-upload-message");
const hostedFlyerLink = document.querySelector("#hosted-flyer-link");

const openingsList = document.querySelector("#owned-openings-list");
const openingsMessage = document.querySelector("#owned-openings-message");
const refreshOpenings = document.querySelector("#refresh-openings");
const openingViews = document.querySelector("#opening-views");
const openingViewButtons = openingViews.querySelectorAll("[data-opening-view]");
const loadMoreOpenings = document.querySelector("#load-more-openings");

const supportedServices = new Set(["facebook", "instagram", "twitter"]);
const displayedOpeningIds = new Set();
const sendingOpeningIds = new Set();

let availableChannels = [];
let channelRequest = 0;
let previewedOpening = null;
let openingView = "open";
let nextOpeningOffset = null;
let openingsRequestId = 0;

function appendText(parent, tag, text) {
  const element = document.createElement(tag);
  element.textContent = text;
  parent.append(element);
  return element;
}

function addOption(select, value, label) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  select.append(option);
}

async function getJSON(url, options) {
  const response = await fetch(url, options);
  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      result.error ||
      result.message ||
      `Request failed (HTTP ${response.status}).`
    );
  }

  return result;
}

function getSelectedChannels() {
  if (channelSelect.value === "all") {
    return availableChannels;
  }

  return availableChannels.filter(
    (channel) => channel.id === channelSelect.value
  );
}

function channelLabel(channel) {
  const platform = channel.service === "twitter"
    ? "X"
    : channel.service;

  return `${channel.displayName || channel.name} — ${platform}`;
}

async function loadChannels() {
  const request = ++channelRequest;

  availableChannels = [];
  channelSelect.replaceChildren();
  channelSelect.disabled = true;
  selectionMessage.textContent = "";
  statusMessage.textContent = "Loading channels…";

  try {
    const params = new URLSearchParams({
      organizationId: workspaceSelect.value,
    });

    const result = await getJSON(`/api/buffer/channels?${params}`);

    if (request !== channelRequest) return;

    availableChannels = result.channels.filter(
      (channel) => supportedServices.has(channel.service)
    );

    if (!availableChannels.length) {
      statusMessage.textContent =
        "Connect a Facebook, Instagram, or X channel in Buffer first.";
      return;
    }

    addOption(channelSelect, "", "Choose where to share");

    if (availableChannels.length > 1) {
      addOption(
        channelSelect,
        "all",
        `All supported channels (${availableChannels.length})`
      );
    }

    for (const channel of availableChannels) {
      addOption(channelSelect, channel.id, channelLabel(channel));
    }

    channelSelect.disabled = false;
    statusMessage.textContent =
      "Buffer connected. Choose one channel or all supported channels.";
  } catch (error) {
    if (request === channelRequest) {
      statusMessage.textContent = error.message;
    }
  }
}

async function loadWorkspace() {
  try {
    const { signedIn } = await getJSON("/api/connection");
    const logoutForm = document.querySelector("#logout-form");

    if (logoutForm) {
      logoutForm.hidden = !signedIn;
    }

    const account = await getJSON("/api/buffer/account");

    connectedAccount.textContent = account.email;
    reconnectBuffer.hidden = true;

    if (!account.organizations.length) {
      statusMessage.textContent = "No Buffer workspace was found.";
      return;
    }

    for (const workspace of account.organizations) {
      addOption(workspaceSelect, workspace.id, workspace.name);
    }

    workspaceSelect.disabled = false;
    await loadChannels();
  } catch (error) {
    connectedAccount.textContent = "Connection unavailable";
    reconnectBuffer.hidden = false;
    statusMessage.textContent =
      `${error.message} Use Reconnect Buffer above to try again.`;
  }
}

async function loadOwnedSlots({ append = false } = {}) {
  if (
    append &&
    (loadMoreOpenings.disabled || nextOpeningOffset === null)
  ) {
    return;
  }

  const expandedIds = new Set(
    [...openingsList.querySelectorAll("[data-slot-id]")]
      .filter((card) => card.querySelector("details")?.open)
      .map((card) => card.dataset.slotId)
  );

  const requestId = ++openingsRequestId;
  const view = openingView;
  const offset = append ? nextOpeningOffset : 0;

  refreshOpenings.disabled = true;
  loadMoreOpenings.disabled = true;
  openingsList.setAttribute("aria-busy", "true");

  if (!append) {
    nextOpeningOffset = null;
    loadMoreOpenings.hidden = true;
    displayedOpeningIds.clear();
    openingsList.replaceChildren();
  }

  openingsMessage.textContent = append
    ? "Loading more openings…"
    : "Loading your openings…";

  try {
    const params = new URLSearchParams({
      view,
      offset: String(offset),
    });

    const { slots, nextOffset } = await getJSON(`/api/slots?${params}`);

    if (requestId !== openingsRequestId) return;

    let addedCount = 0;

    for (const slot of slots) {
      if (displayedOpeningIds.has(slot.id)) continue;

      updatePreviewBufferButton(
        slot.id,
        slot.channels,
        slot.status
      );

      const card = renderOpeningCard(slot);

      if (expandedIds.has(slot.id)) {
        card.querySelector("details").open = true;
      }

      openingsList.append(card);
      displayedOpeningIds.add(slot.id);
      addedCount += 1;
    }

    nextOpeningOffset = nextOffset;
    openingsMessage.textContent = "";

    if (!append && slots.length === 0) {
      openingsMessage.textContent = view === "open"
        ? "You have no upcoming openings."
        : "Filled and expired openings will appear here.";
    } else if (append && addedCount > 0) {
      openingsMessage.textContent = addedCount === 1
        ? "1 more opening loaded."
        : `${addedCount} more openings loaded.`;
    }
  } catch (error) {
    if (requestId === openingsRequestId) {
      openingsMessage.textContent = error.message;
    }
  } finally {
    if (requestId === openingsRequestId) {
      openingsList.removeAttribute("aria-busy");
      refreshOpenings.disabled = false;
      loadMoreOpenings.disabled = false;
      loadMoreOpenings.hidden = nextOpeningOffset === null;
    }
  }
}

function renderOpeningCard(slot) {
  const article = document.createElement("article");
  article.className = "connection-card opening-list-card";
  article.dataset.slotId = slot.id;

  const heading = document.createElement("div");
  heading.className = "opening-card-heading";

  appendText(heading, "h3", slot.service_name);

  const requestCount = slot.requests.length;
  const pendingCount = slot.requests.filter(
    (request) => request.status === "pending"
  ).length;

  if (slot.status === "open" && pendingCount > 0) {
    const badge = appendText(
      heading,
      "span",
      `${pendingCount} pending`
    );

    badge.className = "opening-pending-badge";
  }

  article.append(heading);

  const date = new Intl.DateTimeFormat("en-GB", {
    timeZone: slot.timezone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(slot.starts_at));

  appendText(article, "p", `${date} · ${slot.timezone}`);

  const statusLabel =
    slot.status.charAt(0).toUpperCase() + slot.status.slice(1);

  const requestLabel =
    `${requestCount} ${requestCount === 1 ? "request" : "requests"}`;

  appendText(article, "p", `${statusLabel} · ${requestLabel}`);

  const details = document.createElement("details");
  details.className = "opening-card-details";

  appendText(details, "summary", "View details");

  const card = document.createElement("div");
  card.className = "opening-card-body";

  details.append(card);
  article.append(details);

  const customerLink = appendText(
    card,
    "a",
    "Open customer page →"
  );

  customerLink.className = "nav-link";
  customerLink.href =
    `/slot.html?id=${encodeURIComponent(slot.id)}`;

  if (slot.channels.length) {
    appendBufferDrafts(card, slot);
  }

  appendText(card, "h4", `Requests (${requestCount})`);

  if (requestCount === 0) {
    appendText(card, "p", "No requests yet.");
  }

  for (const request of slot.requests) {
    const requestCard = document.createElement("div");
    requestCard.className = "customer-request";

    appendText(requestCard, "strong", request.name);
    appendText(requestCard, "p", request.email);

    if (request.message) {
      appendText(requestCard, "p", request.message);
    }

    appendText(requestCard, "p", `Status: ${request.status}`);

    if (slot.status === "open" && request.status === "pending") {
      const reviewButton = appendText(
        requestCard,
        "button",
        "Review booking emails"
      );

      reviewButton.type = "button";
      reviewButton.className = "button-secondary";

      const reviewStatus = appendText(requestCard, "p", "");
      reviewStatus.setAttribute("role", "status");

      reviewButton.addEventListener("click", async () => {
        reviewButton.disabled = true;
        reviewStatus.textContent = "";

        try {
          await showBookingEmailReview(slot.id, request.id);
        } catch (error) {
          reviewStatus.textContent = error.message;
        } finally {
          reviewButton.disabled = false;
        }
      });
    }

    card.append(requestCard);
  }

  return article;
}



function setupBookingSenderEditor(slotId, requestId, preview) {
  const form = document.querySelector("#booking-email-form");
  const senderLine = document.querySelector("#booking-email-sender");
  const badge = document.querySelector("#booking-sender-badge");
  const editor = document.querySelector("#booking-sender-editor");
  const input = document.querySelector("#booking-sender-input");
  const review = document.querySelector("#review-booking-sender");
  const confirmation = document.querySelector("#booking-sender-confirmation");
  const question = document.querySelector("#booking-sender-question");
  const save = document.querySelector("#save-booking-sender");
  const message = document.querySelector("#booking-sender-message");
  const verification = document.querySelector("#booking-reply-verification");
  const codeInput = document.querySelector("#booking-reply-code");
  const verifyCode = document.querySelector("#verify-booking-reply-code");
  const notify = document.querySelector("#confirm-and-notify");
  const bookingStatus = document.querySelector("#booking-email-status");
  const otherApplicants = document.querySelector("#other-applicants-email");

  const slotPath = `/api/slots/${encodeURIComponent(slotId)}`;
  const senderUrl = `${slotPath}/email-sender`;
  const confirmUrl =
    `${slotPath}/requests/${encodeURIComponent(requestId)}/confirm`;

  let currentSender = preview;
  let emailToSave = "";
  let busy = false;
  let bookingConfirmed = false;

  function updateControls() {
    const email = currentSender.senderEmail?.trim() || "";
    const verified = Boolean(email && currentSender.senderVerified);

    verification.hidden = !editor.hidden || !email || verified;
    badge.disabled = busy || bookingConfirmed;
    input.disabled = editor.hidden || busy;
    review.disabled = input.disabled;
    save.disabled = input.disabled;
    codeInput.disabled = verification.hidden || busy;
    verifyCode.disabled = codeInput.disabled;

    notify.textContent = bookingConfirmed
      ? "Done"
      : "Confirm & notify";

    notify.type = bookingConfirmed ? "button" : "submit";

    notify.disabled =
      busy ||
      (!bookingConfirmed &&
        (!verified ||
          !editor.hidden ||
          !preview.customerEmail?.trim()));
  }

  function showSender(sender) {
    currentSender = sender;

    const email = sender.senderEmail?.trim() || "";
    const verified = Boolean(email && sender.senderVerified);

    senderLine.textContent = email;
    input.value = email;
    badge.textContent = verified
      ? "Verified"
      : "Verification pending";

    badge.dataset.verified = String(verified);
    updateControls();
  }

  editor.hidden = true;
  confirmation.hidden = true;
  message.textContent = "";

  bookingStatus.textContent = preview.customerEmail?.trim()
    ? ""
    : "The selected customer has no email address on file.";

  codeInput.value = "";
  notify.type = "submit";
  form.onsubmit = submitBooking;

  notify.onclick = (event) => {
    if (!bookingConfirmed) return;

    event.preventDefault();
    form.closest("dialog")?.close();
  };

  showSender(preview);

  badge.onclick = () => {
    if (busy || bookingConfirmed) return;

    editor.hidden = !editor.hidden;
    confirmation.hidden = true;

    showSender(currentSender);

    if (!editor.hidden) input.focus();
  };

  input.oninput = () => {
    confirmation.hidden = true;
    message.textContent = "";
  };

  review.onclick = () => {
    const email = input.value.trim();

    if (!email || !input.reportValidity()) {
      message.textContent = "Enter a valid reply email address.";
      input.focus();
      return;
    }

    emailToSave = email;
    question.textContent = `Send a verification code to ${email}?`;
    confirmation.hidden = false;
  };

  save.onclick = async () => {
    if (confirmation.hidden || busy || editor.hidden) return;

    const email = input.value.trim();

    if (
      !email ||
      !input.reportValidity() ||
      email !== emailToSave
    ) {
      confirmation.hidden = true;
      message.textContent = "Check the address and review it again.";
      input.focus();
      return;
    }

    busy = true;
    message.textContent = "";
    updateControls();

    try {
      const sender = await getJSON(senderUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      if (form.onsubmit !== submitBooking) return;

      editor.hidden = true;
      confirmation.hidden = true;
      codeInput.value = "";

      showSender(sender);

      message.textContent = sender.senderVerified
        ? "This reply email is already verified."
        : `Code sent to ${sender.senderEmail}.`;
    } catch (error) {
      if (form.onsubmit === submitBooking) {
        message.textContent = error.message;
      }
    } finally {
      if (form.onsubmit === submitBooking) {
        busy = false;
        updateControls();

        if (!verification.hidden) codeInput.focus();
      }
    }
  };

  verifyCode.onclick = async () => {
    if (busy || verification.hidden) return;

    const code = codeInput.value.trim();

    if (!/^\d{6}$/.test(code)) {
      message.textContent = "Enter the six-digit code from your email.";
      codeInput.focus();
      return;
    }

    busy = true;
    message.textContent = "";
    updateControls();

    try {
      const sender = await getJSON(`${senderUrl}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });

      if (form.onsubmit !== submitBooking) return;

      codeInput.value = "";
      showSender(sender);

      message.textContent =
        "Reply email verified. Customer replies will go here.";
    } catch (error) {
      if (form.onsubmit === submitBooking) {
        message.textContent = error.message;
      }
    } finally {
      if (form.onsubmit === submitBooking) {
        busy = false;
        updateControls();

        if (!verification.hidden) {
          codeInput.focus();
        } else {
          badge.focus();
        }
      }
    }
  };

  async function submitBooking(event) {
    if (event.submitter?.formMethod === "dialog") return;

    event.preventDefault();

    if (
      bookingConfirmed ||
      busy ||
      event.submitter !== notify ||
      notify.disabled ||
      !form.reportValidity()
    ) {
      return;
    }

    const confirmed = {
      subject: document
        .querySelector("#confirmed-email-subject")
        .value.trim(),
      body: document
        .querySelector("#confirmed-email-body")
        .value.trim(),
    };

    const declined = otherApplicants.hidden
      ? null
      : {
          subject: document
            .querySelector("#declined-email-subject")
            .value.trim(),
          body: document
            .querySelector("#declined-email-body")
            .value.trim(),
        };

    busy = true;
    bookingStatus.textContent = "Confirming booking…";
    updateControls();

    try {
      const result = await getJSON(confirmUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bookingEmails: {
            replyEmail: currentSender.senderEmail,
            confirmed,
            declined,
          },
        }),
      });

      void loadOwnedSlots();

      if (form.onsubmit !== submitBooking) return;

      bookingConfirmed = true;
      bookingStatus.textContent = result.message;
    } catch (error) {
      if (form.onsubmit === submitBooking) {
        bookingStatus.textContent = error.message;
      }
    } finally {
      if (form.onsubmit === submitBooking) {
        busy = false;
        updateControls();
      }
    }
  }
}

async function showBookingEmailReview(slotId, requestId) {
  const url =
    `/api/slots/${encodeURIComponent(slotId)}` +
    `/requests/${encodeURIComponent(requestId)}/email-preview`;

  const { preview } = await getJSON(url);

  const dialog = document.querySelector("#booking-email-dialog");
  const form = document.querySelector("#booking-email-form");

  if (dialog.open) return;

  form.reset();

  const appointmentTime = new Intl.DateTimeFormat("en-GB", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: preview.timeZone,
  }).format(new Date(preview.startsAt));

  document.querySelector("#confirmed-email-recipient").textContent =
    `${preview.customerName} · ${preview.customerEmail || "No email on file"}`;

  document.querySelector("#confirmed-email-body").value = [
    `Hi ${preview.customerName},`,
    "",
    `Your appointment with ${preview.businessName} is confirmed.`,
    "",
    `Service: ${preview.serviceName}`,
    `Date and time: ${appointmentTime} (${preview.timeZone})`,
    `Location: ${preview.location}`,
    "",
    "See you soon,",
    preview.businessName,
  ].join("\n");

  const count = Number(preview.otherApplicantCount);
  const otherApplicants = document.querySelector("#other-applicants-email");

  otherApplicants.hidden = count === 0;
  otherApplicants.disabled = count === 0;

  document.querySelector("#declined-email-recipient-count").textContent =
    `${count} ${count === 1 ? "recipient" : "recipients"}`;

  document.querySelector("#declined-email-body").value = [
    "Hi,",
    "",
    `Thanks for requesting ${preview.serviceName} with ${preview.businessName}. ` +
      "That opening has been filled.",
    "",
    "If you’d like to arrange another time, reply to this email and tell us what works for you.",
    "",
    "Thank you,",
    preview.businessName,
  ].join("\n");

  setupBookingSenderEditor(slotId, requestId, preview);
  dialog.showModal();
}

function hideOpeningPreview() {
  openingPreview.hidden = true;
  openingMessage.textContent = "";
  saveMessage.textContent = "";
  previewedOpening = null;

  saveOpeningButton.disabled = false;

  savedOpeningLink.hidden = true;
  savedOpeningLink.removeAttribute("href");

  saveFlyerButton.hidden = true;
  saveFlyerButton.disabled = false;
  saveFlyerButton.textContent = "Review & share";
  delete saveFlyerButton.dataset.slotId;

  flyerUploadMessage.textContent = "";
  hostedFlyerLink.hidden = true;
  hostedFlyerLink.removeAttribute("href");
}

workspaceSelect.addEventListener("change", loadChannels);
workspaceSelect.addEventListener("change", hideOpeningPreview);

channelSelect.addEventListener("change", () => {
  const selected = getSelectedChannels();

  selectionMessage.textContent = selected.length
    ? `Sharing through: ${selected.map(channelLabel).join(", ")}`
    : "";

  hideOpeningPreview();
});

openingViewButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const view = button.dataset.openingView;
    if (view === openingView) return;

    openingView = view;

    openingViewButtons.forEach((option) => {
      option.setAttribute(
        "aria-pressed",
        String(option.dataset.openingView === openingView)
      );
    });

    loadOwnedSlots();
  });
});

refreshOpenings.addEventListener("click", () => loadOwnedSlots());

loadMoreOpenings.addEventListener("click", () => {
  loadOwnedSlots({ append: true });
});

openingForm.addEventListener("input", hideOpeningPreview);

openingForm.addEventListener("submit", (event) => {
  event.preventDefault();
  hideOpeningPreview();

  if (!workspaceSelect.value || !channelSelect.value) {
    openingMessage.textContent =
      "Choose your publishing channel above first.";
    return;
  }

  const values = new FormData(openingForm);

  const businessName = values.get("businessName").trim();
  const serviceName = values.get("serviceName").trim();
  const location = values.get("location").trim();
  const description = values.get("description").trim();

  if (!businessName || !serviceName || !location) {
    openingMessage.textContent =
      "Enter your business name, service, and location.";
    return;
  }

  // Interpret the entered time as Lagos time on every device.
  const startsAt = new Date(`${values.get("startsAt")}:00+01:00`);

  if (
    !Number.isFinite(startsAt.getTime()) ||
    startsAt.getTime() <= Date.now()
  ) {
    openingMessage.textContent = "Choose a future appointment time.";
    return;
  }

  const formattedDate = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Lagos",
    dateStyle: "full",
    timeStyle: "short",
  }).format(startsAt);

  const price = Number(values.get("price"));
  const durationMinutes = Number(values.get("durationMinutes"));
  const selectedChannels = getSelectedChannels();

  const formattedPrice = new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
  }).format(price);

  previewContent.textContent = [
    businessName,
    serviceName,
    "",
    `When: ${formattedDate} WAT`,
    `Duration: ${durationMinutes} minutes`,
    `Price: ${formattedPrice}`,
    `Location: ${location}`,
    "",
    description,
    "",
    `Channels: ${selectedChannels.map(channelLabel).join(", ")}`,
    "",
    "Customers request this opening. You confirm the booking.",
  ].join("\n");

  previewedOpening = {
    id: crypto.randomUUID(),
    businessName,
    serviceName,
    location,
    description,
    startsAt: startsAt.toISOString(),
    durationMinutes,
    price: price.toFixed(2),
    organizationId: workspaceSelect.value,
    channelIds: selectedChannels.map((channel) => channel.id),
  };

  downloadFlyer.href = renderOpeningFlyer(previewedOpening);

  openingPreview.hidden = false;
  openingPreview.scrollIntoView({ block: "start" });
});

saveOpeningButton.addEventListener("click", async () => {
  if (!previewedOpening || saveOpeningButton.disabled) return;

  const opening = previewedOpening;

  const controls = [
    ...openingForm.querySelectorAll("input, textarea, button"),
    workspaceSelect,
    channelSelect,
  ];

  const previousStates = controls.map((control) => control.disabled);

  controls.forEach((control) => {
    control.disabled = true;
  });

  saveOpeningButton.disabled = true;
  saveMessage.textContent = "Saving your opening…";

  let saved = false;

  try {
    const response = await fetch("/api/slots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(opening),
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || "Could not save the opening.");
    }

    saved = true;

    saveFlyerButton.disabled = false;
    saveFlyerButton.textContent = "Review & share";
    saveFlyerButton.dataset.slotId = result.slot.id;
    saveFlyerButton.hidden = false;

    savedOpeningLink.href =
      `/slot.html?id=${encodeURIComponent(result.slot.id)}`;

    savedOpeningLink.hidden = false;

    saveMessage.textContent =
      "Opening saved. It has not been published to social media yet.";

    if (openingView === "open") {
      loadOwnedSlots();
    }
  } catch (error) {
    saveMessage.textContent =
      `${error.message} You can retry saving this preview.`;
  } finally {
    controls.forEach((control, index) => {
      control.disabled = previousStates[index];
    });

    saveOpeningButton.disabled = saved;
  }
});


saveFlyerButton.addEventListener("click", () => {
  if (saveFlyerButton.disabled) return;

  openPublishingReview(
    saveFlyerButton.dataset.slotId
  );
});

openingViews.hidden = false;
loadOwnedSlots();
loadWorkspace();
