import { afterEach, describe, expect, it, vi } from 'vitest';
import { TranslatorService } from '../../assets/translate';

type Availability = 'unavailable' | 'downloadable' | 'downloading' | 'available';

function fakeApi(availability: Availability | (() => Promise<Availability>) = 'available') {
    const translate = vi.fn(async (text: string) => `[cs] ${text}`);
    const api = {
        availability: vi.fn(typeof availability === 'function' ? availability : async () => availability),
        create: vi.fn(async () => ({ translate })),
    };

    return { api, translate };
}

function setUserActivation(isActive: boolean): void {
    Object.defineProperty(navigator, 'userActivation', { value: { isActive }, configurable: true });
}

afterEach(() => {
    setUserActivation(false);
    delete (globalThis as { Translator?: unknown }).Translator;
});

describe('TranslatorService', () => {
    it('passes English through', async () => {
        const service = new TranslatorService(undefined);
        expect(await service.translate('A dog', 'en')).toEqual({ status: 'identity', text: 'A dog' });
        expect(await service.translate('', 'cs')).toEqual({ status: 'identity', text: '' });
        expect(await service.availability('en')).toBe('available');
    });

    it('reports unavailable without the API', async () => {
        const service = new TranslatorService(undefined);
        expect(service.supported).toBe(false);
        expect(await service.availability('cs')).toBe('unavailable');
        expect(await service.translate('A dog', 'cs')).toEqual({ status: 'unavailable' });
    });

    it('detects the global Translator API', () => {
        const { api } = fakeApi();
        (globalThis as { Translator?: unknown }).Translator = api;
        expect(new TranslatorService().supported).toBe(true);
    });

    it('translates and caches one translator per language', async () => {
        const { api, translate } = fakeApi('available');
        const service = new TranslatorService(api);

        expect(await service.translate('A dog', 'cs')).toEqual({ status: 'translated', text: '[cs] A dog' });
        expect(await service.translate('A cat', 'cs')).toEqual({ status: 'translated', text: '[cs] A cat' });
        expect(api.create).toHaveBeenCalledTimes(1);
        expect(api.create).toHaveBeenCalledWith({ sourceLanguage: 'en', targetLanguage: 'cs' });
        expect(translate).toHaveBeenCalledTimes(2);
    });

    it('treats a throwing availability() as unavailable', async () => {
        const { api } = fakeApi(async () => {
            throw new Error('boom');
        });
        expect(await new TranslatorService(api).translate('x', 'cs')).toEqual({ status: 'unavailable' });
    });

    it('treats an unsupported pair as unavailable', async () => {
        const { api } = fakeApi('unavailable');
        expect(await new TranslatorService(api).translate('x', 'xx')).toEqual({ status: 'unavailable' });
    });

    it('needs a user gesture to download a language pack', async () => {
        const { api } = fakeApi('downloadable');
        const service = new TranslatorService(api);

        expect(await service.translate('A dog', 'cs')).toEqual({ status: 'needs-gesture' });
        expect(service.needsGesture).toBe(true);
        expect(api.create).not.toHaveBeenCalled();

        service.prime();
        expect(service.needsGesture).toBe(false);
        expect(api.create).toHaveBeenCalledTimes(1);
        expect(await service.translate('A dog', 'cs')).toEqual({ status: 'translated', text: '[cs] A dog' });
    });

    it('creates immediately when the user is interacting', async () => {
        setUserActivation(true);
        const { api } = fakeApi('downloading');
        expect(await new TranslatorService(api).translate('A dog', 'cs')).toEqual({ status: 'translated', text: '[cs] A dog' });
    });

    it('prime() ignores English and forgets failed creations', async () => {
        const { api } = fakeApi('downloadable');
        api.create.mockRejectedValueOnce(new Error('no pack'));
        const service = new TranslatorService(api);

        service.prime(['en', 'cs']);
        expect(api.create).toHaveBeenCalledTimes(1);
        await Promise.resolve();
        await Promise.resolve();

        setUserActivation(true);
        expect(await service.translate('x', 'cs')).toEqual({ status: 'translated', text: '[cs] x' });
        expect(api.create).toHaveBeenCalledTimes(2);
    });

    it('recovers when translate() throws', async () => {
        const { api, translate } = fakeApi('available');
        translate.mockRejectedValueOnce(new Error('fail'));
        const service = new TranslatorService(api);

        expect(await service.translate('x', 'cs')).toEqual({ status: 'unavailable' });
        expect(await service.translate('x', 'cs')).toEqual({ status: 'translated', text: '[cs] x' });
        expect(api.create).toHaveBeenCalledTimes(2);
    });
});
