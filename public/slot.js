
const message = document.querySelector("#slot-message");
const card = document.querySelector("#public-slot");
const requestForm = document.querySelector("#request-form");
const requestFields = document.querySelector("#request-fields");
const requestResult = document.querySelector("#request-result");

let currentSlot = null;


function addDetail(label, value) {
  const row = document.createElement("div");
  const term = document.createElement("dt");
  const description = document.createElement("dd");

  term.textContent = label;
  description.textContent = value;

  row.append(term, description);
  document.querySelector("#slot-details").append(row);
}

async function loadSlot() {
  const id = new URLSearchParams(window.location.search).get("id");

  if (!id) {
    message.textContent = "This opening link is incomplete.";
    return;
  }

  try {
    const response = await fetch(
      `/api/slots/public/${encodeURIComponent(id)}`
    );

    if (!response.ok) {
      message.textContent = response.status === 404
        ? "This opening could not be found."
        : "We couldn’t load this opening. Please try again.";
      return;
    }

    const { slot } = await response.json();
    currentSlot = slot;
    requestForm.hidden = slot.status !== "open";


    document.querySelector("#slot-business").textContent =
      slot.business_name;

    document.querySelector("#slot-service").textContent =
      slot.service_name;

    document.querySelector("#slot-description").textContent =
      slot.description;

    const availability = {
      open: "Available for requests",
      filled: "This opening has been filled.",
      cancelled: "This opening has been cancelled.",
      expired: "This appointment time has passed.",
    };

    document.querySelector("#slot-availability").textContent =
      availability[slot.status] || "Currently unavailable.";

    const date = new Intl.DateTimeFormat("en-GB", {
      timeZone: slot.timezone,
      dateStyle: "full",
      timeStyle: "short",
    }).format(new Date(slot.starts_at));

    addDetail("When", date);
    addDetail("Time zone", slot.timezone);
    addDetail("Duration", `${slot.duration_minutes} minutes`);
    addDetail("Location", slot.location);

    addDetail(
      "Price",
      new Intl.NumberFormat("en-NG", {
        style: "currency",
        currency: slot.currency,
      }).format(Number(slot.price))
    );

    message.textContent = "";
    card.hidden = false;

    document.title = `${slot.service_name} — SlotBack`;
  } catch (error) {
    message.textContent =
      "We couldn’t load this opening. Please refresh to try again.";
  }
}

loadSlot();
requestForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!currentSlot || requestFields.disabled) return;

  const values = new FormData(requestForm);

  requestFields.disabled = true;
  requestResult.textContent = "Sending your request…";

  let received = false;

  try {
    const response = await fetch(
      `/api/slots/public/${encodeURIComponent(currentSlot.id)}/requests`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: values.get("name"),
          email: values.get("email"),
          message: values.get("message"),
        }),
      }
    );

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      if (response.status === 409) {
        requestForm.hidden = true;

        document.querySelector("#slot-availability").textContent =
          "This opening is no longer accepting requests.";
      }

      throw new Error(result.error || "Could not submit your request.");
    }

    received = true;
    requestForm.hidden = true;
    requestForm.reset();

    requestResult.textContent = result.message;
  } catch (error) {
    requestResult.textContent =
      `${error.message} Refresh to check availability before trying again.`;
  } finally {
    requestFields.disabled = received;
  }
});

