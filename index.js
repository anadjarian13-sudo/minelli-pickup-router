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

// Shopify envoie un RAW BODY → OBLIGATOIRE pour vérifier la signature
app.use(
  "/webhooks/orders-create",
  bodyParser.raw({ type: "application/json" })
);

// --------------------------------------------------
// Vérification de la signature Shopify (si fournie)
// --------------------------------------------------
function verifyWebhook(req) {
  const hmac = req.get("X-Shopify-Hmac-Sha256");

  // Si Shopify n’envoie pas de signature → on ne vérifie pas
  if (!hmac) return null; // null = pas de signature

  const digest = crypto
    .createHmac("sha256", SHOPIFY_WEBHOOK_SECRET)
    .update(req.body, "utf8")
    .digest("base64");

  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmac));
}

// --------------------------------------------------
// Liste des boutiques (à compléter)
// --------------------------------------------------
const boutiques = {
  "Aix-en-Provence": {
    name: "MINELLI Aix-en-Provence",
    address1: "7 rue des Bagniers",
    city: "Aix-en-Provence",
    zip: "13100",
    country: "FR"
  },

  // ------ ajoute ici TOUTES les boutiques ------
};

// --------------------------------------------------
// WEBHOOK : création d'une commande
// --------------------------------------------------
app.post("/webhooks/orders-create", async (req, res) => {
  console.log("Webhook received");

  try {
    const signatureCheck = verifyWebhook(req);

    // ❗ Si Shopify a envoyé une signature et qu'elle est invalide → on refuse
    if (signatureCheck === false) {
      console.log("Invalid signature");
      return res.status(401).send("Invalid webhook signature");
    }

    // À ce stade :
    // ✔ signatureCheck === true → signature valide
    // ✔ signatureCheck === null → pas de signature (tests manuels acceptés)

    const order = JSON.parse(req.body.toString("utf8"));
    console.log("Order parsed:", order.id);

    // Vérifier si la commande est un retrait boutique
    const shippingLine = (order.shipping_lines || [])[0];
    const isPickup =
      shippingLine &&
      shippingLine.title &&
      shippingLine.title.toLowerCase().includes("retrait");

    if (!isPickup) {
      console.log("Not a pickup order");
      return res.status(200).send("Not pickup order");
    }

    // Boutique sélectionnée par le client
    const notes = order.note_attributes || [];
    const bAttr = notes.find((n) => n.name === "boutique_retrait");

    if (!bAttr) {
      console.log("No boutique selected");
      return res.status(200).send("No boutique selected");
    }

    const boutique = boutiques[bAttr.value];
    if (!boutique) {
      console.log("Unknown boutique:", bAttr.value);
      return res.status(200).send("Unknown boutique");
    }

    console.log("Boutique found:", boutique.name);

    const clientAddr = order.shipping_address || {};

    // Nouvelle adresse = adresse de la boutique
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

    // Sauvegarder l'adresse d'origine dans les notes
    const newNotes = [
      ...notes.filter((n) => n.name !== "adresse_client_originale"),
      {
        name: "adresse_client_originale",
        value: `${clientAddr.address1}, ${clientAddr.zip} ${clientAddr.city}`
      }
    ];

    // URL Shopify pour modifier la commande
    const url = `https://${SHOPIFY_SHOP}/admin/api/2024-01/orders/${order.id}.json`;

    console.log("Updating order on Shopify…");

    // PUT → mise à jour Shopify
    const response = await fetch(url, {
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

    if (!response.ok) {
      const txt = await response.text();
      console.log("Shopify update error:", txt);
      return res.status(500).send("Shopify update failed");
    }

    console.log("Order updated successfully");
    res.status(200).send("OK");
  } catch (e) {
    console.error("ERROR in webhook:", e);
    res.status(500).send("Error");
  }
});

// --------------------------------------------------
// SERVER
// --------------------------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`Running pickup router on port ${PORT}`)
);
