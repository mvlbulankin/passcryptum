from django.urls import path

from .views import ProfileView

urlpatterns = [
    path("profiles/", ProfileView.as_view(), name="profiles"),
]
