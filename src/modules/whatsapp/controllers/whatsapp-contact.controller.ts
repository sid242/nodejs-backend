import type { Request, Response } from 'express';

import { asyncHandler } from '@/lib/async-handler';
import { AppResponse } from '@/lib/responses';

import * as contactRepo from '../repositories/whatsapp-contact.repository';

export const listContacts = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenant!.id;
  const { search, limit, offset } = req.query as Record<string, string | undefined>;
  const contacts = await contactRepo.listContacts(
    tenantId,
    search,
    limit ? Number(limit) : undefined,
    offset ? Number(offset) : undefined,
  );
  AppResponse.ok(contacts, 'Contacts fetched successfully').send(res);
});

export const getContact = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenant!.id;
  const id = req.params.id as string;
  const contact = await contactRepo.findContactById(tenantId, id);
  AppResponse.ok(contact, 'Contact fetched successfully').send(res);
});

export const createContact = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenant!.id;
  const contact = await contactRepo.createContact({
    tenantId,
    phoneNumber: req.body.phoneNumber,
    displayName: req.body.displayName,
  });
  AppResponse.created(contact, 'Contact created successfully').send(res);
});

export const updateConsent = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenant!.id;
  const id = req.params.id as string;
  const consent = await contactRepo.upsertConsent({
    tenantId,
    contactId: id,
    purpose: req.body.purpose,
    status: req.body.status,
    consentSource: req.body.consentSource || 'ADMIN',
  });
  AppResponse.ok(consent, 'Consent updated successfully').send(res);
});
