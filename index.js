import express from "express";
import crypto from "crypto";
import bodyParser from "body-parser";
import fetch from "node-fetch";

const {
  SHOPIFY_SHOP,
  SHOPIFY_ACCESS_TOKEN,
  SHOPIFY_WEBHOOK_SECRET
} = process.env;

const app = express();

app.use(
  "/webhooks/orders-create",
  bodyParser.raw({ type: "application/json" })
);

// Vérification de la signature Shopify
function verifyWebhook(req) {
  const hmac = req.get("X-Shopify-Hmac-Sha256");
  const digest = crypto
    .createHmac("sha256", SHOPIFY_WEBHOOK_SECRET)
    .update(req.body, "utf8")
    .digest("base64");
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmac));
}

// Boutiques → à remplir progressivement
const boutiques = {
  "Aix-en-Provence": {
    name: "MINELLI Aix-en-Provence",
    address1: "7 rue des Bagniers",
    city: "Aix-en-Provence",
    zip: "13100",
    country: "FR"
  }
  // ajoute les autres ensuite
};

app.post("/webhooks/orders-create", async (req, res) => {
  try {
    if (!verifyWebhook(req)) {
      return res.status(401).send("Invalid webhook signature");
    }

    const order = JSON.parse(req.body.toString("utf8"));

    const shippingLine = (order.shipping_lines || [])[0];
    const isPickup =
      shippingLine &&
      shippingLine.title &&
      shippingLine.title.toLowerCase().includes("retrait");

    if (!isPickup) return res.status(200).send("Not pickup order");

    const notes = order.note_attributes || [];
    const bAttr = notes.find((n) => n.name === "boutique_retrait");
    if (!bAttr) return res.status(200).send("No boutique selected");

    const boutique = boutiques[bAttr.value];
    if (!boutique) return res.status(200).send("Unknown boutique");

    const clientAddr = order.shipping_address || {};

    // New address → Boutique
    const newAddress = {
      first_name: clientAddr.first_name,
      last_name: clientAddr.last_name,
      company: boutique.name,
      address1: boutique.address1,
      city: boutique.city,
      zip: boutique.zip,
      country: "France",
      country_code: "FR",
      phone: clientAddr.phone
    };

    // Keep original client address in notes
    const newNotes = [
      ...notes.filter((n) => n.name !== "adresse_client_originale"),
      {
        name: "adresse_client_originale",
        value: `${clientAddr.address1}, ${clientAddr.zip} ${clientAddr.city}`
      }
    ];

    // Update order
    const url = `https://${SHOPIFY_SHOP}/admin/api/2024-01/orders/${order.id}.json`;

    await fetch(url, {
      method: "PUT",
      headers: {
        "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        order: {
          id: order.id,
          shipping_address: newAddress,
          note_attributes: newNotes
        }
      })
    });

    res.status(200).send("OK");
  } catch (e) {
    console.error(e);
    res.status(500).send("Error");
  }
});

app.listen(process.env.PORT || 3000, () =>
  console.log("Running pickup router")
);
