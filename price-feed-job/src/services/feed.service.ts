import type { ByProjectKeyRequestBuilder } from '@commercetools/platform-sdk';
import { logger } from '../utils/logger.utils.js';

/** One row of the nightly price feed, as an ERP would send it. */
export interface FeedRow {
  sku: string;
  currencyCode: string;
  centAmount: number;
  country?: string;
}

/**
 * Where the feed comes from — deliberately an interface with one implementation.
 *
 * In production this is an SFTP drop, an S3 object or an ERP endpoint. In the course it is a Custom
 * Object, so the job is genuinely complete and runnable without inventing infrastructure nobody has.
 * Swapping it is one file, which is the point: the job's logic does not know or care.
 */
export interface FeedSource {
  read(): Promise<FeedRow[]>;
}

export class CustomObjectFeedSource implements FeedSource {
  constructor(
    private readonly apiRoot: ByProjectKeyRequestBuilder,
    private readonly container: string,
    private readonly key: string
  ) {}

  async read(): Promise<FeedRow[]> {
    try {
      const { body } = await this.apiRoot
        .customObjects()
        .withContainerAndKey({ container: this.container, key: this.key })
        .get()
        .execute();
      const rows = (body.value as { rows?: unknown })?.rows;
      if (!Array.isArray(rows)) {
        logger.warn('Feed document has no `rows` array — treating as empty', {
          container: this.container,
          key: this.key,
        });
        return [];
      }
      return rows.filter(isFeedRow);
    } catch (error) {
      if ((error as { statusCode?: number }).statusCode === 404) {
        logger.info('No feed document today — nothing to import', { container: this.container, key: this.key });
        return [];
      }
      throw error;
    }
  }
}

function isFeedRow(value: unknown): value is FeedRow {
  const row = value as FeedRow;
  return (
    typeof row?.sku === 'string' &&
    typeof row?.currencyCode === 'string' &&
    typeof row?.centAmount === 'number' &&
    Number.isFinite(row.centAmount) &&
    (row.country === undefined || typeof row.country === 'string')
  );
}

/**
 * The feed's price key — the identity the Import API upserts on. Same convention the seeder stamps
 * onto the catalogue's prices, which is what makes this an UPDATE rather than an ever-growing pile of
 * new prices the storefront never shows.
 */
export function priceKeyFor(row: FeedRow): string {
  return `${row.sku}-${row.currencyCode}${row.country ? `-${row.country}` : ''}`;
}
