/* Behavior + structural-compat tests for the credential-card bridge. The
 * bridge output must stay assignable to the real @absolutejs/ai
 * CredentialSpec WITHOUT this package depending on it at runtime — type-only
 * import, same pattern as compat.test.ts. */
import { describe, expect, test } from 'bun:test';
import type { CredentialSpec } from '@absolutejs/ai/ui';
import { envRequirementsToCredentialCard } from '../src/index';
import type { EnvRequirement } from '../src/types';

const requirements: ReadonlyArray<EnvRequirement> = [
	{
		description: 'Stripe secret key',
		docsUrl: 'https://dashboard.stripe.com/apikeys',
		key: 'STRIPE_SECRET_KEY',
		secret: true
	},
	{
		description: 'Public base URL of the deployment',
		key: 'PUBLIC_BASE_URL',
		secret: false
	},
	{
		description: 'Google OAuth client secret',
		key: 'GOOGLE_CLIENT_SECRET',
		when: 'providersConfiguration.google'
	}
];

describe('envRequirementsToCredentialCard', () => {
	test('maps requirements to keys with conservative secret defaults', () => {
		const spec = envRequirementsToCredentialCard(
			requirements,
			(key) => key === 'STRIPE_SECRET_KEY'
		);
		expect(spec.title).toBe('Configure credentials');
		expect(spec.keys).toHaveLength(requirements.length);
		expect(spec.keys[0]).toEqual({
			docsUrl: 'https://dashboard.stripe.com/apikeys',
			isSet: true,
			key: 'STRIPE_SECRET_KEY',
			label: 'Stripe secret key',
			secret: true
		});
		expect(spec.keys[1]?.secret).toBe(false);
		expect(spec.keys[1]?.isSet).toBe(false);
		// when-gated entries are included as-is — callers pre-filter.
		expect(spec.keys[2]?.key).toBe('GOOGLE_CLIENT_SECRET');
		// Undefined secret maps to true, the conservative default.
		expect(spec.keys[2]?.secret).toBe(true);
	});

	test('honors title and cardId options', () => {
		const spec = envRequirementsToCredentialCard(
			requirements,
			() => false,
			{ cardId: 'auth-credentials', title: 'Connect Google sign-in' }
		);
		expect(spec.title).toBe('Connect Google sign-in');
		expect(spec.cardId).toBe('auth-credentials');
	});

	test('output is assignable to @absolutejs/ai CredentialSpec', () => {
		const spec: CredentialSpec = envRequirementsToCredentialCard(
			requirements,
			() => false
		);
		expect(spec.keys.length).toBeGreaterThan(0);
	});
});
