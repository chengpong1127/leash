import { type JWK, exportJWK, generateKeyPair, importJWK } from "jose";
import { type Db, schema } from "../db";

export const PROOF_ALG = "EdDSA";

interface SigningKey {
  kid: string;
  privateKey: CryptoKey;
  publicJwk: JWK;
}

const cache = new WeakMap<Db, Promise<SigningKey>>();

/** Leash's proof-signing key. Generated on first use and persisted in the database. */
export function getSigningKey(db: Db): Promise<SigningKey> {
  let key = cache.get(db);
  if (!key) {
    key = load(db);
    cache.set(db, key);
    key.catch(() => cache.delete(db));
  }
  return key;
}

async function load(db: Db): Promise<SigningKey> {
  let row = db.select().from(schema.signingKeys).get();
  if (!row) {
    const { privateKey, publicKey } = await generateKeyPair(PROOF_ALG, { crv: "Ed25519", extractable: true });
    const kid = `leash-${Date.now().toString(36)}`;
    db.insert(schema.signingKeys)
      .values({
        id: kid,
        privateJwk: { ...(await exportJWK(privateKey)) },
        publicJwk: { ...(await exportJWK(publicKey)), kid, alg: PROOF_ALG, use: "sig" },
        createdAt: new Date(),
      })
      .run();
    // Re-read so that two processes racing on first run agree on the oldest key.
    row = db.select().from(schema.signingKeys).orderBy(schema.signingKeys.createdAt).get()!;
  }
  const privateKey = (await importJWK(row.privateJwk as JWK, PROOF_ALG)) as CryptoKey;
  return { kid: row.id, privateKey, publicJwk: row.publicJwk as JWK };
}

/** Public keys for `GET /api/v1/jwks.json`. */
export async function getJwks(db: Db): Promise<{ keys: JWK[] }> {
  return { keys: [(await getSigningKey(db)).publicJwk] };
}
