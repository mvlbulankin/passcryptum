from django.urls import path

from .views import CredentialView, ProfileView

urlpatterns = [
    path("credentials/", CredentialView.as_view(), name="credentials"),
    path("profiles/", ProfileView.as_view(), name="profiles"),
]
