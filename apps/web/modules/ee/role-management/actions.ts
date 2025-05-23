"use server";

import { IS_FORMBRICKS_CLOUD, USER_MANAGEMENT_MINIMUM_ROLE } from "@/lib/constants";
import { getMembershipByUserIdOrganizationId } from "@/lib/membership/service";
import { getUserManagementAccess } from "@/lib/membership/utils";
import { getOrganization } from "@/lib/organization/service";
import { authenticatedActionClient } from "@/lib/utils/action-client";
import { checkAuthorizationUpdated } from "@/lib/utils/action-client-middleware";
import { getRoleManagementPermission } from "@/modules/ee/license-check/lib/utils";
import { updateInvite } from "@/modules/ee/role-management/lib/invite";
import { updateMembership } from "@/modules/ee/role-management/lib/membership";
import { ZInviteUpdateInput } from "@/modules/ee/role-management/types/invites";
import { z } from "zod";
import { ZId, ZUuid } from "@formbricks/types/common";
import { AuthenticationError, OperationNotAllowedError, ValidationError } from "@formbricks/types/errors";
import { ZMembershipUpdateInput } from "@formbricks/types/memberships";

export const checkRoleManagementPermission = async (organizationId: string) => {
  const organization = await getOrganization(organizationId);
  if (!organization) {
    throw new Error("Organization not found");
  }

  const isRoleManagementAllowed = await getRoleManagementPermission(organization.billing.plan);
  if (!isRoleManagementAllowed) {
    throw new OperationNotAllowedError("Role management is not allowed for this organization");
  }
};

const ZUpdateInviteAction = z.object({
  inviteId: ZUuid,
  organizationId: ZId,
  data: ZInviteUpdateInput,
});

export type TUpdateInviteAction = z.infer<typeof ZUpdateInviteAction>;

export const updateInviteAction = authenticatedActionClient
  .schema(ZUpdateInviteAction)
  .action(async ({ ctx, parsedInput }) => {
    const currentUserMembership = await getMembershipByUserIdOrganizationId(
      ctx.user.id,
      parsedInput.organizationId
    );
    if (!currentUserMembership) {
      throw new AuthenticationError("User not a member of this organization");
    }

    await checkAuthorizationUpdated({
      userId: ctx.user.id,
      organizationId: parsedInput.organizationId,
      access: [
        {
          data: parsedInput.data,
          schema: ZInviteUpdateInput,
          type: "organization",
          roles: ["owner", "manager"],
        },
      ],
    });

    if (!IS_FORMBRICKS_CLOUD && parsedInput.data.role === "billing") {
      throw new ValidationError("Billing role is not allowed");
    }

    if (currentUserMembership.role === "manager" && parsedInput.data.role !== "member") {
      throw new OperationNotAllowedError("Managers can only invite members");
    }

    await checkRoleManagementPermission(parsedInput.organizationId);

    return await updateInvite(parsedInput.inviteId, parsedInput.data);
  });

const ZUpdateMembershipAction = z.object({
  userId: ZId,
  organizationId: ZId,
  data: ZMembershipUpdateInput,
});

export const updateMembershipAction = authenticatedActionClient
  .schema(ZUpdateMembershipAction)
  .action(async ({ ctx, parsedInput }) => {
    const currentUserMembership = await getMembershipByUserIdOrganizationId(
      ctx.user.id,
      parsedInput.organizationId
    );
    if (!currentUserMembership) {
      throw new AuthenticationError("User not a member of this organization");
    }
    const hasUserManagementAccess = getUserManagementAccess(
      currentUserMembership.role,
      USER_MANAGEMENT_MINIMUM_ROLE
    );

    if (!hasUserManagementAccess) {
      throw new OperationNotAllowedError("User management is not allowed for your role");
    }

    await checkAuthorizationUpdated({
      userId: ctx.user.id,
      organizationId: parsedInput.organizationId,
      access: [
        {
          data: parsedInput.data,
          schema: ZMembershipUpdateInput,
          type: "organization",
          roles: ["owner", "manager"],
        },
      ],
    });

    if (!IS_FORMBRICKS_CLOUD && parsedInput.data.role === "billing") {
      throw new ValidationError("Billing role is not allowed");
    }

    if (currentUserMembership.role === "manager" && parsedInput.data.role !== "member") {
      throw new OperationNotAllowedError("Managers can only assign users to the member role");
    }

    await checkRoleManagementPermission(parsedInput.organizationId);

    return await updateMembership(parsedInput.userId, parsedInput.organizationId, parsedInput.data);
  });
