import Stripe from "stripe";

export function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("Missing STRIPE_SECRET_KEY env var");
  }
  return new Stripe(key, {
    apiVersion: "2025-12-15.clover",
  });
}
