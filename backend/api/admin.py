from django.contrib import admin
from django.contrib.auth.models import Group, User

from credentials.models import Credential
from profiles.models import Profile


@admin.register(Profile)
class ProfileAdmin(admin.ModelAdmin):
    list_filter = (
        "public_key",
        "services",
    )
    ordering = ("public_key",)


@admin.register(Credential)
class CredentialAdmin(admin.ModelAdmin):
    list_display = (
        "profile",
        "pin",
        "protector",
        "entropy",
    )
    ordering = ("profile",)


admin.site.unregister(Group)
admin.site.unregister(User)
