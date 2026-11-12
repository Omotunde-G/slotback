function canPublishChannel(channel) {
  return channel.postId
    ? channel.status === "draft"
    : channel.status == null || channel.status === "rejected";
}

function publishingLabel(channel) {
  const labels = {
    draft: "Draft saved — ready to publish",
    scheduled: "Accepted by Buffer for publishing",
    sending: "Publishing",
    sent: "Published",
    needs_approval: "Awaiting Buffer approval",
    error: "Publishing failed — check Buffer",
    rejected: "Not accepted — review and retry",
    submitting: "Submission in progress — do not resend",
    unknown: "Result uncertain — check Buffer",
  };

  return (
    labels[channel.status] ||
    (channel.postId ? "Saved in Buffer" : "Ready to share")
  );
}

function bufferSendState(channels) {
  return {
    allSaved:
      channels.length > 0 &&
      channels.every(channel => channel.postId),

    canRetry: channels.some(canPublishChannel),

    label: "Review & share",
  };
}

function updatePreviewBufferButton(
  slotId,
  channels,
  status = "open"
) {
  if (saveFlyerButton.dataset.slotId !== slotId) return;

  const available =
    status === "open" &&
    channels.some(canPublishChannel);

  saveFlyerButton.hidden = !available;
  saveFlyerButton.disabled = sendingOpeningIds.has(slotId);
  saveFlyerButton.textContent = "Review & share";

  flyerUploadMessage.textContent = channels
    .map(
      channel =>
        `${channel.name}: ${publishingLabel(channel)}`
    )
    .join(" · ");
}

function appendBufferDrafts(card, slot) {
  appendText(card, "h4", "Social posts");

  const list = document.createElement("ul");
list.className = "social-post-list";

for (const channel of slot.channels) {
  const item = document.createElement("li");

  item.append(
    SlotBackSocial.account(
      channel,
      publishingLabel(channel)
    )
  );

  list.append(item);
}

card.append(list);
  if (
    slot.status !== "open" ||
    !slot.channels.some(canPublishChannel)
  ) {
    return;
  }

  const button = appendText(
    card,
    "button",
    "Review & share"
  );

  button.type = "button";
  button.className = "button";
  button.disabled = sendingOpeningIds.has(slot.id);

  button.onclick = () => openPublishingReview(slot.id);
}

async function openPublishingReview(slotId) {
  if (!slotId || sendingOpeningIds.has(slotId)) return;

  sendingOpeningIds.add(slotId);

  const base = `/api/slots/${encodeURIComponent(slotId)}`;

  let dialog;
  let submitted = false;

  try {
    const opening = await getJSON(
      `${base}/publishing-preview`
    );

    if (
      opening.status !== "open" ||
      new Date(opening.starts_at) <= new Date()
    ) {
      throw new Error(
        "This opening is no longer available."
      );
    }

    let flyer = opening.flyer_url;

    if (!flyer) {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1080;

      flyer = renderOpeningFlyer(
        {
          businessName: opening.business_name,
          serviceName: opening.service_name,
          startsAt: opening.starts_at,
          durationMinutes: opening.duration_minutes,
          price: opening.price,
          location: opening.location,
        },
        canvas
      );
    }

    dialog = document.createElement("dialog");
    dialog.className = "publishing-dialog";

    dialog.setAttribute(
      "aria-labelledby",
      "publishing-title"
    );

    dialog.innerHTML = `
      <form class="publishing-form">
        <h2 id="publishing-title">Review & share</h2>

        <p>
          Check your flyer, caption and channels before sending.
        </p>

        <img
          class="publishing-flyer"
          alt="Your opening flyer"
        >

        <label>
          Caption
          <textarea
            name="caption"
            rows="4"
            maxlength="5000"
            required
          ></textarea>
        </label>

        <p>Your booking link will be added automatically:</p>

        <a
          class="publishing-link"
          target="_blank"
          rel="noopener"
        ></a>

        <fieldset class="publishing-channels">
          <legend>Channels</legend>
        </fieldset>

        <label>
          Publishing option
          <select name="action">
            <option value="draft">Save draft</option>
            <option value="now">Post now</option>
            <option value="schedule">Schedule</option>
          </select>
        </label>

        <label class="publishing-time" hidden>
          Publish date and time — Lagos (WAT)

          <input
            name="dueAt"
            type="datetime-local"
          >

          <small>
            At least one minute ahead and before the appointment.
          </small>
        </label>

        <p
          class="publishing-status"
          role="status"
          aria-live="polite"
        ></p>

        <div class="publishing-actions">
          <button
            type="button"
            class="button-secondary publishing-close"
          >
            Cancel
          </button>

          <button
            type="submit"
            class="button publishing-submit"
          >
            Save draft
          </button>
        </div>
      </form>
    `;

    const form = dialog.querySelector("form");

    const status = dialog.querySelector(
      ".publishing-status"
    );

    const submit = dialog.querySelector(
      ".publishing-submit"
    );

    const close = dialog.querySelector(
      ".publishing-close"
    );

    const action = form.elements.action;
    const time = form.elements.dueAt;

    let busy = false;

    dialog.querySelector("img").src = flyer;
    form.elements.caption.value = opening.caption;

    const link = dialog.querySelector(".publishing-link");

    link.href = opening.bookingUrl;
    link.textContent = opening.bookingUrl;

    for (const channel of opening.channels) {
      const label = document.createElement("label");
      const input = document.createElement("input");

      input.type = "checkbox";
      input.name = "channel";
      input.value = channel.id;
      input.disabled = !canPublishChannel(channel);
      input.checked = !input.disabled;

    label.append(
  input,
  SlotBackSocial.account(
    channel,
    publishingLabel(channel)
  )
);

      dialog
        .querySelector(".publishing-channels")
        .append(label);
    }

    submit.disabled =
      !opening.channels.some(canPublishChannel);

    action.onchange = () => {
      const scheduling = action.value === "schedule";

      dialog.querySelector(".publishing-time").hidden =
        !scheduling;

      time.required = scheduling;

      submit.textContent = {
        draft: "Save draft",
        now: "Post now",
        schedule: "Schedule post",
      }[action.value];
    };

    close.onclick = () => {
      if (!busy) dialog.close();
    };

    dialog.addEventListener("cancel", event => {
      if (busy) event.preventDefault();
    });

    form.onsubmit = async event => {
      event.preventDefault();

      if (
        busy ||
        submitted ||
        !form.reportValidity()
      ) {
        return;
      }

      const selected = [
        ...form.querySelectorAll(
          '[name="channel"]:checked'
        ),
      ].map(input => input.value);

      if (!selected.length) {
        status.textContent = "Choose at least one channel.";
        return;
      }

      const choice = action.value;

      // The entered time is explicitly Lagos/WAT, regardless
      // of the browser's own timezone.
      const scheduled =
        choice === "schedule"
          ? new Date(`${time.value}:00+01:00`)
          : null;

      if (
        scheduled &&
        (
          !Number.isFinite(scheduled.getTime()) ||
          scheduled.getTime() < Date.now() + 60000 ||
          scheduled >= new Date(opening.starts_at)
        )
      ) {
        status.textContent =
          "Choose a Lagos time at least one minute ahead " +
          "and before the appointment.";

        return;
      }

      const payload = {
        action: choice,
        caption: form.elements.caption.value.trim(),
        channelIds: selected,

        ...(scheduled
          ? { dueAt: scheduled.toISOString() }
          : {}),
      };

      if (!payload.caption) {
        status.textContent = "Enter your caption.";
        return;
      }

      busy = true;

      for (const control of form.elements) {
        control.disabled = true;
      }

      status.textContent = "Sending to Buffer…";

      try {
        if (!opening.flyer_url) {
          const image = await (await fetch(flyer)).blob();

          const saved = await getJSON(`${base}/flyer`, {
            method: "POST",
            headers: {
              "Content-Type": "image/jpeg",
            },
            body: image,
          });

          opening.flyer_url = saved.flyerUrl;
        }

        submitted = true;

        const result = await getJSON(`${base}/publish`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        status.textContent = result.results
          .map(item => `${item.channel}: ${item.message}`)
          .join("\n");

        updatePreviewBufferButton(
          slotId,
          result.channels
        );
      } catch (error) {
        status.textContent =
          `${error.message} Close this review and check ` +
          "the channel status before another attempt.";
      } finally {
        busy = false;
        close.disabled = false;
        close.textContent = "Done";
        close.focus();
      }
    };

    document.body.append(dialog);
    dialog.showModal();

    await new Promise(resolve => {
      dialog.addEventListener("close", resolve, {
        once: true,
      });
    });
  } catch (error) {
    openingsMessage.textContent = error.message;
    flyerUploadMessage.textContent = error.message;
  } finally {
    dialog?.remove();
    sendingOpeningIds.delete(slotId);

    await loadOwnedSlots();
  }
}
